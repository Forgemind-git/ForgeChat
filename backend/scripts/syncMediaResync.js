// Daily cron: re-upload to Meta any media that has auto_resync=true and
// whose Meta media_id expires within the next 24 hours (or has already
// expired). One row per (media, account); each handled independently.

require('dotenv').config();
const pool = require('../src/db');
const { syncMediaToAccount } = require('../src/routes/mediaLibrary');

async function main() {
  const startedAt = new Date();
  console.log(`[resyncCron] starting at ${startedAt.toISOString()}`);
  const { rows } = await pool.query(`
    SELECT s.media_id, s.account_id, s.expires_at, s.status
      FROM coexistence.media_meta_sync s
      JOIN coexistence.media_library m ON m.id = s.media_id
     WHERE m.deleted_at IS NULL
       AND m.auto_resync = TRUE
       AND (
            s.status = 'expired'
         OR (s.status = 'synced' AND s.expires_at IS NOT NULL
             AND s.expires_at < NOW() + INTERVAL '24 hours')
       )
  `);
  console.log(`[resyncCron] ${rows.length} (media, account) pair(s) to refresh`);

  let ok = 0, fail = 0;
  for (const r of rows) {
    try {
      await syncMediaToAccount(r.media_id, r.account_id);
      ok++;
      console.log(`[resyncCron] ✓ media=${r.media_id} account=${r.account_id}`);
    } catch (err) {
      fail++;
      console.error(`[resyncCron] ✗ media=${r.media_id} account=${r.account_id}: ${err.message}`);
    }
  }
  console.log(`[resyncCron] done in ${Date.now() - startedAt.getTime()}ms — ok=${ok} fail=${fail}`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(err => {
  console.error('[resyncCron] fatal:', err);
  process.exit(1);
});
