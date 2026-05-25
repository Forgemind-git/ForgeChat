const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { downloadOne, MEDIA_DIR } = require('../services/mediaDownloader');
const { assertContactAccess } = require('../middleware/access');

const router = Router();

function resolveSafe(absPath) {
  if (!absPath) return null;
  const resolved = path.resolve(absPath);
  if (!resolved.startsWith(path.resolve(MEDIA_DIR) + path.sep)) return null;
  return resolved;
}

// GET /api/media/:messageId — stream stored media bytes, auth required.
router.get('/media/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { rows } = await pool.query(
      `SELECT message_id, message_type, media_storage_path, media_mime_type,
              media_status, media_filename, message_body, wa_number, contact_number
         FROM coexistence.chat_history
        WHERE message_id = $1`,
      [messageId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Message not found' });
    // Per-conversation access: non-admins may only stream media from
    // conversations they're assigned to (admins bypass). Prevents downloading
    // any message's media by guessing a message_id (IDOR).
    if (!(await assertContactAccess(req, res, row.wa_number, row.contact_number))) return;
    if (row.media_status !== 'stored' || !row.media_storage_path) {
      return res.status(404).json({ error: 'Media not available', status: row.media_status });
    }
    const abs = resolveSafe(row.media_storage_path);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({ error: 'File missing on disk' });
    }
    const mime = row.media_mime_type || 'application/octet-stream';
    const total = fs.statSync(abs).size;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    // Advertise byte-range support so browsers can seek/scrub AND scan to the
    // end to compute Ogg/Opus duration (otherwise audio.duration === Infinity).
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.query.download === '1' || row.message_type === 'document') {
      const fname = row.media_filename || row.message_body || `${messageId}`;
      res.setHeader('Content-Disposition',
        `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${fname.replace(/[^\w. -]/g, '_')}"`);
    }

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
      let end = m && m[2] !== '' ? parseInt(m[2], 10) : total - 1;
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`);
        return res.end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(abs, { start, end }).pipe(res);
    }

    res.setHeader('Content-Length', total);
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    console.error('[media] GET error:', err.message);
    res.status(500).json({ error: 'Failed to read media' });
  }
});

// POST /api/media/:messageId/retry — re-attempt download
router.post('/media/:messageId/retry', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wa_number, contact_number FROM coexistence.chat_history WHERE message_id = $1`,
      [req.params.messageId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Message not found' });
    if (!(await assertContactAccess(req, res, rows[0].wa_number, rows[0].contact_number))) return;
    const result = await downloadOne(req.params.messageId);
    res.json(result);
  } catch (err) {
    console.error('[media] retry error:', err.message);
    res.status(500).json({ error: 'Retry failed' });
  }
});

module.exports = { router };
