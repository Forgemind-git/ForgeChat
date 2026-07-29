// Downloads WhatsApp media from Meta's CDN and persists it to local disk so
// it survives Meta's ~5min URL expiry and ~30day retention. Runs async,
// fire-and-forget from the webhook handler. Idempotent by message_id.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pool = require('../db');
const { getMediaInfo, downloadMediaBinary } = require('../integrations/metaMedia');
const { decrypt } = require('../util/crypto');

const pexecFile = promisify(execFile);

// Resolve the per-account Meta access token for a business number. `wa_number`
// on chat_history is the account's own display phone; match it (digits-only, to
// tolerate '+'/spaces) or the phone_number_id. Returns null when not found, so
// metaMedia falls back to the META_ACCESS_TOKEN env var if one is set.
async function resolveAccountToken(waNumber) {
  if (!waNumber) return null;
  const { rows } = await pool.query(
    `SELECT access_token_encrypted FROM coexistence.whatsapp_accounts
      WHERE regexp_replace(display_phone_number, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
         OR phone_number_id = $1
      LIMIT 1`,
    [String(waNumber)]
  );
  if (!rows[0]?.access_token_encrypted) return null;
  try { return decrypt(rows[0].access_token_encrypted) || null; } catch { return null; }
}
const MEDIA_DIR = process.env.MEDIA_DIR || '/app/media';
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'voice', 'document', 'sticker']);
const TRANSCODE_AUDIO = process.env.MEDIA_TRANSCODE_AUDIO !== 'false';  // default on
const TRANSCODE_MIME_RE = /^audio\/(ogg|opus|amr|3gpp)/i;
const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/amr': 'amr', 'audio/mp4': 'm4a',
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip', 'text/plain': 'txt', 'text/csv': 'csv',
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeBase(input) {
  return String(input || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

function extFor(mime, fallback) {
  return EXT_BY_MIME[(mime || '').toLowerCase()] || fallback || 'bin';
}

/**
 * Transcode WhatsApp voice notes (Ogg/Opus, AMR) to MP3 so Safari can play
 * them natively. Returns { path, mime, sizeBytes } of the converted file, or
 * null if transcode failed (caller keeps the original).
 */
async function transcodeToMp3(srcPath) {
  const outPath = srcPath.replace(/\.[^.]+$/, '.mp3');
  try {
    await pexecFile('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', srcPath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-b:a', '64k',
      outPath,
    ], { timeout: 30_000 });
    const stat = fs.statSync(outPath);
    return { path: outPath, mime: 'audio/mpeg', sizeBytes: stat.size };
  } catch (err) {
    console.error(`[mediaDownloader] transcode failed for ${srcPath}: ${err.message}`);
    try { fs.unlinkSync(outPath); } catch {}
    return null;
  }
}

async function markStatus(messageId, status, fields = {}) {
  const sets = ['media_status = $1'];
  const params = [status];
  let i = 2;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  params.push(messageId);
  await pool.query(
    `UPDATE coexistence.chat_history SET ${sets.join(', ')} WHERE message_id = $${i}`,
    params
  );
}

/**
 * Download a single media row by message_id. Idempotent — skips if already stored.
 * Returns { ok: boolean, path?: string, error?: string }.
 */
async function downloadOne(messageId) {
  const { rows } = await pool.query(
    `SELECT message_id, wa_number, message_type, media_url, media_mime_type, media_status, media_storage_path, timestamp
       FROM coexistence.chat_history
      WHERE message_id = $1`,
    [messageId]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: 'row not found' };
  if (!MEDIA_TYPES.has(row.message_type)) return { ok: false, error: 'not a media type' };
  if (!row.media_url) return { ok: false, error: 'no media_id in media_url column' };
  if (row.media_status === 'stored' && row.media_storage_path) {
    return { ok: true, path: row.media_storage_path };
  }

  const mediaId = row.media_url;
  try {
    await markStatus(messageId, 'downloading', { media_error: null });

    const accessToken = await resolveAccountToken(row.wa_number);
    const info = await getMediaInfo(mediaId, accessToken);
    const bin = await downloadMediaBinary(info.url, accessToken);
    const mime = info.mime_type || bin.contentType;
    const ext = extFor(mime);
    const ts = row.timestamp ? new Date(row.timestamp) : new Date();
    const ym = `${ts.getUTCFullYear()}${String(ts.getUTCMonth() + 1).padStart(2, '0')}`;
    const wa = safeBase(row.wa_number) || 'unknown';
    const dir = path.join(MEDIA_DIR, wa, ym);
    ensureDir(dir);
    const filename = `${safeBase(messageId)}.${ext}`;
    let finalPath = path.join(dir, filename);
    let finalMime = mime;
    let finalSize = bin.contentLength;
    fs.writeFileSync(finalPath, bin.buffer);

    // Transcode Ogg/Opus or AMR voice notes to MP3 for Safari compatibility
    if (TRANSCODE_AUDIO && (row.message_type === 'audio' || row.message_type === 'voice')
        && TRANSCODE_MIME_RE.test(mime)) {
      const transcoded = await transcodeToMp3(finalPath);
      if (transcoded) {
        try { fs.unlinkSync(finalPath); } catch {}
        finalPath = transcoded.path;
        finalMime = transcoded.mime;
        finalSize = transcoded.sizeBytes;
      }
    }

    await markStatus(messageId, 'stored', {
      media_storage_path: finalPath,
      media_mime_type: finalMime,
      media_size_bytes: finalSize,
      media_downloaded_at: new Date().toISOString(),
    });

    return { ok: true, path: finalPath };
  } catch (err) {
    const status = err.status === 404 || err.status === 410 ? 'expired' : 'failed';
    await markStatus(messageId, status, { media_error: (err.message || String(err)).slice(0, 500) }).catch(() => {});
    console.error(`[mediaDownloader] ${messageId}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Mark a record pending so the UI shows the downloading skeleton immediately,
 * regardless of how long the queue takes to pick it up. Best-effort; failures
 * are non-fatal.
 */
async function markPending(messageId) {
  try { await markStatus(messageId, 'pending'); } catch {}
}

/**
 * Backfill helper — iterates recent media rows that haven't been stored yet.
 */
async function backfillRecent({ days = 30, limit = 500 } = {}) {
  const { rows } = await pool.query(
    `SELECT message_id FROM coexistence.chat_history
      WHERE message_type = ANY($1::text[])
        AND media_url IS NOT NULL
        AND (media_status IS NULL OR media_status IN ('pending','failed'))
        AND timestamp > NOW() - ($2::int || ' days')::interval
      ORDER BY timestamp DESC
      LIMIT $3`,
    [[...MEDIA_TYPES], days, limit]
  );
  let ok = 0, fail = 0;
  for (const r of rows) {
    const res = await downloadOne(r.message_id);
    if (res.ok) ok++; else fail++;
  }
  return { attempted: rows.length, ok, fail };
}

// Mirror an outbound media buffer to MEDIA_DIR so the chat bubble can render it
// via /api/media/:messageId. Path layout matches inbound: <wa>/<yyyymm>/<msgid>.<ext>.
function persistOutboundBuffer({ accountPhoneDigits, messageId, buffer, ext }) {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(MEDIA_DIR, accountPhoneDigits || 'unknown', ym);
  ensureDir(dir);
  const filename = `${String(messageId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200)}.${ext || 'bin'}`;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(absPath, buffer);
  return { absPath, size: buffer.length };
}

module.exports = { downloadOne, markPending, backfillRecent, persistOutboundBuffer, MEDIA_DIR, MEDIA_TYPES };
