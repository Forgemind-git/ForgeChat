#!/usr/bin/env node
// One-time / on-demand backfill: download all media for recent messages
// that haven't been stored yet. Run inside the backend container:
//   docker exec forgecrm-backend node scripts/backfillMedia.js
// Optional flags: --days 30 --limit 500

require('dotenv').config();
const { backfillRecent } = require('../src/services/mediaDownloader');

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return parseInt(args[i + 1], 10);
  return fallback;
}

(async () => {
  const days = flag('days', 30);
  const limit = flag('limit', 500);
  console.log(`[backfill] Scanning last ${days} days, limit ${limit}…`);
  try {
    const result = await backfillRecent({ days, limit });
    console.log(`[backfill] Done: attempted=${result.attempted} ok=${result.ok} fail=${result.fail}`);
    process.exit(0);
  } catch (err) {
    console.error('[backfill] Fatal:', err.message);
    process.exit(1);
  }
})();
