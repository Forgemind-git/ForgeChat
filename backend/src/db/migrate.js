// Boot-time migration runner. Applies db/migrations/*.sql that haven't been
// recorded yet, tracked in coexistence.schema_migrations. Idempotent and safe
// to run on every boot: the SQL files themselves are already IF [NOT] EXISTS /
// guarded, and a ledger row is written only on success.
//
// Invoked from index.js start() BEFORE ensureTables()/app.listen — a failed
// migration throws and aborts boot (start().catch exits), so the operator sees
// the failing file instead of a half-migrated DB serving traffic.

const fs = require('fs');
const path = require('path');

// Serialize concurrent boots (multiple replicas) so two processes don't apply
// the same file at once. Arbitrary 64-bit-safe int constant.
const MIGRATE_LOCK = 739104255;

function migrationsDir() {
  // Resolve across layouts: MIGRATIONS_DIR override, the container image
  // (/app/src/db -> /app/db/migrations), and the repo (backend/src/db ->
  // <repo>/db/migrations). First existing wins.
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.join(__dirname, '../../db/migrations'),
    path.join(__dirname, '../../../db/migrations'),
  ].filter(Boolean);
  return candidates.find(d => fs.existsSync(d)) || candidates[candidates.length - 1];
}

async function runMigrations(pool) {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    console.warn(`[migrate] migrations directory not found at ${dir} — skipping (set MIGRATIONS_DIR if this is wrong)`);
    return;
  }

  await pool.query('CREATE SCHEMA IF NOT EXISTS coexistence');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coexistence.schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort(); // zero-padded names => numeric order
  const { rows } = await pool.query('SELECT filename FROM coexistence.schema_migrations');
  const applied = new Set(rows.map(r => r.filename));
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log(`[migrate] up to date (${files.length} migration${files.length === 1 ? '' : 's'})`);
    return;
  }

  let count = 0;
  for (const f of pending) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATE_LOCK]);
      // Re-check inside the lock — a concurrent boot may have just applied it.
      const chk = await client.query('SELECT 1 FROM coexistence.schema_migrations WHERE filename = $1', [f]);
      if (chk.rows.length) { await client.query('COMMIT'); continue; }
      await client.query('SET LOCAL search_path TO coexistence, public');
      await client.query(sql); // multi-statement file via simple query protocol
      await client.query('INSERT INTO coexistence.schema_migrations (filename) VALUES ($1)', [f]);
      await client.query('COMMIT');
      count++;
      console.log(`[migrate] applied ${f}`);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      console.error(`[migrate] FAILED on ${f}: ${err.message}`);
      throw err; // abort boot
    } finally {
      client.release();
    }
  }
  console.log(`[migrate] applied ${count} new migration(s); ${files.length - count} already present`);
}

module.exports = { runMigrations };
