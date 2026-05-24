#!/usr/bin/env node
// Refresh all WhatsApp accounts' templates from Meta. Run from cron every 4h:
//   docker exec forgecrm-backend node scripts/syncTemplates.js
require('dotenv').config();
const pool = require('../src/db');
const { syncAccountTemplates } = require('../src/routes/templates');
const { getAccountWithToken } = require('../src/routes/whatsappAccounts');
const { markAccountHealth, classifyMetaError } = require('../src/services/accountHealth');

(async () => {
  const { rows } = await pool.query(`SELECT id FROM coexistence.whatsapp_accounts WHERE is_active = TRUE`);
  console.log(`[sync] Scanning ${rows.length} active account(s)…`);
  let totalUpdated = 0, totalRemote = 0, failed = 0;
  for (const r of rows) {
    const account = await getAccountWithToken(r.id);
    if (!account?.accessToken) { failed++; continue; }
    try {
      const out = await syncAccountTemplates(account);
      totalUpdated += out.updated;
      totalRemote += out.total;
      await markAccountHealth(account.id, 'healthy');
      console.log(`[sync] account=${account.displayName}: updated ${out.updated}/${out.total}`);
    } catch (err) {
      failed++;
      await markAccountHealth(account.id, classifyMetaError(err), err.message).catch(() => {});
      console.error(`[sync] account=${account.displayName} failed: ${err.message}`);
    }
  }
  console.log(`[sync] done. updated=${totalUpdated} of ${totalRemote} (failed accounts: ${failed})`);
  process.exit(0);
})().catch(err => { console.error('[sync] fatal:', err.message); process.exit(1); });
