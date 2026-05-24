#!/usr/bin/env node
// Refresh template analytics for every template that has a meta_template_id.
// Run from host cron daily:
//   0 2 * * * docker exec forgecrm-backend node scripts/syncTemplateAnalytics.js >> /var/log/forgecrm-analytics-sync.log 2>&1

require('dotenv').config();
const pool = require('../src/db');
const { refreshOne } = require('../src/services/templateAnalytics');

(async () => {
  const days = parseInt(process.env.ANALYTICS_SYNC_DAYS, 10) || 30;
  const { rows: tpls } = await pool.query(
    `SELECT * FROM coexistence.message_templates
      WHERE meta_template_id IS NOT NULL
        AND whatsapp_account_id IS NOT NULL
        AND status IN ('APPROVED','PAUSED','DISABLED','SUBMITTED','REJECTED')`
  );
  console.log(`[analytics-sync] Refreshing ${tpls.length} template(s), window=${days}d`);
  let okCount = 0, failCount = 0, totalPoints = 0;
  for (const tpl of tpls) {
    try {
      const r = await refreshOne(tpl, { days });
      okCount++;
      totalPoints += r.points;
      console.log(`[analytics-sync] ${tpl.name}/${tpl.language}: ${r.points} day(s) cached (totals: sent=${r.totals.sent}, delivered=${r.totals.delivered}, read=${r.totals.read}, clicked=${r.totals.clicked})`);
    } catch (err) {
      failCount++;
      console.error(`[analytics-sync] ${tpl.name}/${tpl.language} failed: ${err.message}`);
    }
  }
  console.log(`[analytics-sync] Done. ok=${okCount} fail=${failCount} totalDataPoints=${totalPoints}`);
  process.exit(0);
})().catch(err => { console.error('[analytics-sync] fatal:', err.message); process.exit(1); });
