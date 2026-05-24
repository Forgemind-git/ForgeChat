#!/usr/bin/env node
// Disk retention sweep: deletes media files older than MEDIA_RETENTION_DAYS
// from /app/media, marks the corresponding chat_history rows as 'expired',
// and prunes now-empty directories. Run from cron:
//   docker exec forgecrm-backend node scripts/cleanupMedia.js
// Override with: --days 90 --dry-run

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

const MEDIA_DIR = process.env.MEDIA_DIR || '/app/media';
const DEFAULT_DAYS = parseInt(process.env.MEDIA_RETENTION_DAYS || '180', 10);

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}
const days = parseInt(flag('days', DEFAULT_DAYS), 10);
const dryRun = args.includes('--dry-run');

function walk(dir, cutoffMs, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, cutoffMs, acc);
      // Remove empty dir after children processed
      try {
        if (fs.readdirSync(full).length === 0 && !dryRun) fs.rmdirSync(full);
      } catch {}
    } else if (entry.isFile()) {
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.mtimeMs < cutoffMs) {
        acc.files.push({ path: full, size: stat.size });
      }
    }
  }
  return acc;
}

(async () => {
  const cutoffMs = Date.now() - days * 86400 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  console.log(`[cleanup] cutoff=${cutoffIso} dir=${MEDIA_DIR} dryRun=${dryRun}`);

  const acc = walk(MEDIA_DIR, cutoffMs, { files: [] });
  let freed = 0;
  for (const f of acc.files) {
    freed += f.size;
    if (!dryRun) {
      try { fs.unlinkSync(f.path); } catch (err) { console.error(`[cleanup] unlink failed: ${f.path}: ${err.message}`); }
    }
  }

  let dbRows = 0;
  if (!dryRun) {
    const { rowCount } = await pool.query(
      `UPDATE coexistence.chat_history
          SET media_status = 'expired',
              media_storage_path = NULL,
              media_error = 'retention policy: file older than ' || $2 || ' days'
        WHERE media_status = 'stored'
          AND media_downloaded_at < $1`,
      [cutoffIso, days]
    );
    dbRows = rowCount;
  }

  const mb = (freed / 1024 / 1024).toFixed(2);
  console.log(`[cleanup] ${dryRun ? '[DRY] ' : ''}deleted=${acc.files.length} files freed=${mb}MB db_rows_marked_expired=${dbRows}`);
  process.exit(0);
})().catch(err => {
  console.error('[cleanup] fatal:', err.message);
  process.exit(1);
});
