// Media Library route — upload to Postgres object storage, list, sync to
// Meta per WABA, toggle auto-resync, delete.

const { Router } = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const pool = require('../db');
const storage = require('../util/pgStorage');
const { uploadMedia: metaUploadMedia } = require('../integrations/metaSend');
const { getAccountWithToken } = require('./whatsappAccounts');
const { canonicalizeMime, isChatSendable, CHAT_TYPES_MSG } = require('../util/metaMime');
const { requirePermission } = require('../middleware/access');

const router = Router();

// 50 MB upload cap (Meta's documented hard limits are smaller per type —
// 5 MB image, 16 MB video/audio, 100 MB document — we accept up to 50 MB and
// rely on Meta's API to reject anything it dislikes).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const TYPE_MAP = [
  { prefix: 'image/', type: 'image' },
  { prefix: 'video/', type: 'video' },
  { prefix: 'audio/', type: 'audio' },
];
function inferMediaType(mime) {
  for (const m of TYPE_MAP) if (mime.startsWith(m.prefix)) return m.type;
  return 'document';
}

function rowToMedia(r) {
  return {
    id: r.id,
    filename: r.filename,
    originalName: r.original_name,
    name: r.name,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    mediaType: r.media_type,
    sha256: r.sha256,
    autoResync: r.auto_resync,
    notes: r.notes,
    whatsappAccountId: r.whatsapp_account_id,
    uploadedAt: r.uploaded_at,
  };
}

function rowToSync(r) {
  return {
    id: r.id,
    mediaId: r.media_id,
    accountId: r.account_id,
    metaMediaId: r.meta_media_id,
    syncedAt: r.synced_at,
    expiresAt: r.expires_at,
    status: r.status,
    lastError: r.last_error,
    attempts: r.attempts,
    updatedAt: r.updated_at,
  };
}

// Refresh stale 'synced' rows to 'expired' if expires_at < NOW().
async function markExpired() {
  await pool.query(`
    UPDATE coexistence.media_meta_sync
       SET status = 'expired', updated_at = NOW()
     WHERE status = 'synced' AND expires_at IS NOT NULL AND expires_at < NOW()
  `);
}

// GET /api/media-library?accountId=  — media owned by one connected account.
// accountId is optional (omitted = all, for admin/global views), but every
// consumer passes it so media stays scoped to its owning account.
router.get('/media-library', async (req, res) => {
  try {
    await markExpired();
    const accountId = req.query.accountId ? parseInt(req.query.accountId, 10) : null;
    const params = [];
    let accFilter = '';
    // Scope to the selected account, but also surface media that has no owner
    // yet (whatsapp_account_id IS NULL) — e.g. uploaded before any account was
    // connected — so it never becomes invisible. With no accountId, list all.
    if (accountId) { params.push(accountId); accFilter = `AND (whatsapp_account_id = $${params.length} OR whatsapp_account_id IS NULL)`; }
    const { rows: media } = await pool.query(`
      SELECT * FROM coexistence.media_library
       WHERE deleted_at IS NULL ${accFilter}
       ORDER BY uploaded_at DESC
       LIMIT 500
    `, params);
    const ids = media.map(m => m.id);
    let syncs = [];
    if (ids.length) {
      // Scoped to the owning account, so only that account's sync row matters.
      const sParams = [ids];
      let sAcc = '';
      if (accountId) { sParams.push(accountId); sAcc = 'AND account_id = $2'; }
      const { rows: s } = await pool.query(
        `SELECT * FROM coexistence.media_meta_sync WHERE media_id = ANY($1::bigint[]) ${sAcc}`,
        sParams
      );
      syncs = s;
    }
    const syncsByMedia = syncs.reduce((acc, r) => {
      (acc[r.media_id] = acc[r.media_id] || []).push(rowToSync(r));
      return acc;
    }, {});
    res.json({
      media: media.map(m => ({ ...rowToMedia(m), syncs: syncsByMedia[m.id] || [] })),
    });
  } catch (err) {
    console.error('[media-library] list error:', err);
    res.status(500).json({ error: 'Failed to list media' });
  }
});

// POST /api/media-library  (multipart, field "file")
router.post('/media-library', requirePermission('media-library'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { originalname, mimetype, size, buffer } = req.file;
    const name = (req.body?.name || '').toString().slice(0, 255) || null;
    const notes = (req.body?.notes || '').toString().slice(0, 500) || null;

    // Canonicalize the browser-reported MIME to Meta's token and reject anything
    // Meta can't send, so bad media never reaches the library (or Meta) silently.
    const canonMime = canonicalizeMime(mimetype, originalname);
    if (!isChatSendable(canonMime)) {
      return res.status(400).json({ error: `Unsupported file type "${mimetype || 'unknown'}" for WhatsApp. ${CHAT_TYPES_MSG}` });
    }

    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = path.extname(originalname).toLowerCase();
    const stored = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const objectKey = `library/${stored}`;
    const mediaType = inferMediaType(canonMime);

    // Owner account: media belongs to exactly one connected account. Use the
    // account the uploader picked; fall back to the default account.
    let accountId = req.body?.accountId ? parseInt(req.body.accountId, 10) : null;
    if (!accountId) {
      const { rows: def } = await pool.query(
        `SELECT id FROM coexistence.whatsapp_accounts
          ORDER BY is_default DESC, id ASC LIMIT 1`
      );
      accountId = def[0]?.id || null;
    }

    await storage.ensureBucket();
    await storage.putObject(objectKey, buffer, canonMime);

    const { rows } = await pool.query(`
      INSERT INTO coexistence.media_library
        (filename, original_name, name, mime_type, size_bytes, media_type,
         storage_backend, storage_key, sha256, notes, uploaded_by, whatsapp_account_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
      stored, originalname, name, canonMime, size, mediaType,
      storage.bucketName(), objectKey, sha, notes, req.user?.id || null, accountId,
    ]);
    res.json({ media: rowToMedia(rows[0]) });
  } catch (err) {
    console.error('[media-library] upload error:', err);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

// PUT /api/media-library/:id  — auto_resync, name, and notes are editable
router.put('/media-library/:id', requirePermission('media-library'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { autoResync, name, notes } = req.body || {};
    const fields = [];
    const vals = [];
    let i = 1;
    if (autoResync !== undefined) { fields.push(`auto_resync = $${i++}`); vals.push(!!autoResync); }
    if (name !== undefined)       { fields.push(`name = $${i++}`);        vals.push(name ? name.toString().slice(0, 255) : null); }
    if (notes !== undefined)      { fields.push(`notes = $${i++}`);       vals.push(notes); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE coexistence.media_library SET ${fields.join(', ')}
        WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ media: rowToMedia(rows[0]) });
  } catch (err) {
    console.error('[media-library] update error:', err);
    res.status(500).json({ error: 'Failed to update media' });
  }
});

// DELETE /api/media-library/:id  (soft-delete + remove stored object)
router.delete('/media-library/:id', requirePermission('media-library'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `UPDATE coexistence.media_library
          SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING storage_key`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await storage.removeObject(rows[0].storage_key);
    res.json({ ok: true });
  } catch (err) {
    console.error('[media-library] delete error:', err);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

// GET /api/media-library/:id/download  (auth-proxied download)
router.get('/media-library/:id/download', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `SELECT storage_key, mime_type, original_name, name
         FROM coexistence.media_library WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const buf = await storage.getObjectBuffer(rows[0].storage_key);
    res.setHeader('Content-Type', rows[0].mime_type);
    const displayName = rows[0].name || rows[0].original_name;
    res.setHeader('Content-Disposition', `inline; filename="${displayName}"`);
    res.send(buf);
  } catch (err) {
    console.error('[media-library] download error:', err);
    res.status(500).json({ error: 'Failed to download media' });
  }
});

// POST /api/media-library/:id/sync/:accountId — push to Meta for one WABA
async function syncMediaToAccount(mediaId, accountId) {
  const { rows: mRows } = await pool.query(
    `SELECT * FROM coexistence.media_library WHERE id = $1 AND deleted_at IS NULL`,
    [mediaId]
  );
  if (!mRows.length) throw new Error('Media not found');
  const media = mRows[0];

  // Ownership: media belongs to exactly one connected account. Refuse to sync
  // (and therefore use) it under any other account — this replaces the old
  // shared / multi-account model.
  if (media.whatsapp_account_id != null && Number(media.whatsapp_account_id) !== Number(accountId)) {
    throw new Error('This media belongs to a different WhatsApp account');
  }

  const account = await getAccountWithToken(accountId);
  if (!account) throw new Error('WhatsApp account not found');

  // mark syncing
  await pool.query(`
    INSERT INTO coexistence.media_meta_sync
      (media_id, account_id, status, attempts, updated_at)
    VALUES ($1,$2,'syncing',1,NOW())
    ON CONFLICT (media_id, account_id) DO UPDATE
      SET status='syncing', attempts = coexistence.media_meta_sync.attempts + 1, updated_at = NOW()
  `, [mediaId, accountId]);

  try {
    const buf = await storage.getObjectBuffer(media.storage_key);
    const { id: metaId } = await metaUploadMedia({
      accessToken: account.accessToken,
      phoneNumberId: account.phoneNumberId,
      buffer: buf,
      mimeType: canonicalizeMime(media.mime_type, media.original_name),
      filename: media.original_name,
    });
    const { rows } = await pool.query(`
      UPDATE coexistence.media_meta_sync
         SET meta_media_id=$1, status='synced', synced_at=NOW(),
             expires_at = NOW() + INTERVAL '28 days',
             last_error=NULL, updated_at=NOW()
       WHERE media_id=$2 AND account_id=$3
       RETURNING *
    `, [metaId, mediaId, accountId]);
    return rowToSync(rows[0]);
  } catch (err) {
    await pool.query(`
      UPDATE coexistence.media_meta_sync
         SET status='failed', last_error=$1, updated_at=NOW()
       WHERE media_id=$2 AND account_id=$3
    `, [String(err.message || err).slice(0, 500), mediaId, accountId]);
    throw err;
  }
}

router.post('/media-library/:id/sync/:accountId', requirePermission('media-library'), async (req, res) => {
  try {
    const sync = await syncMediaToAccount(
      parseInt(req.params.id, 10),
      parseInt(req.params.accountId, 10),
    );
    res.json({ sync });
  } catch (err) {
    console.error('[media-library] sync error:', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

module.exports = { router, syncMediaToAccount };
