// One-time migration: collapse every existing automation (chatbots.config) to a
// linear keyword→message flow — keep the trigger + message nodes, drop all other
// node types, and rebuild edges as a straight chain. Safe + idempotent: running
// it twice is a no-op, and flows that are already linear are left untouched.
//
//   cd backend && node scripts/migrateLinearAutomations.js

require('dotenv').config();
const pool = require('../src/db');
const { sanitizeToLinear } = require('../src/routes/chatbots');

(async () => {
  try {
    const { rows } = await pool.query('SELECT id, name, config FROM coexistence.chatbots');
    let changed = 0;
    for (const r of rows) {
      const before = JSON.stringify(r.config || {});
      const after = JSON.stringify(sanitizeToLinear(r.config || {}) || {});
      if (before !== after) {
        await pool.query(
          'UPDATE coexistence.chatbots SET config = $1, updated_at = NOW() WHERE id = $2',
          [after, r.id]
        );
        changed++;
        console.log(`  migrated #${r.id} "${r.name}"`);
      }
    }
    console.log(`Done. Linearized ${changed}/${rows.length} automation(s).`);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
