// Media object storage backed by PostgreSQL.
//
// Files are stored as bytea rows in coexistence.media_objects, one row per
// object keyed by `object_key`. This is the project's only object store — there
// is no external object-storage service. The API (ensureBucket / putObject /
// getObjectBuffer / removeObject / bucketName) is intentionally storage-agnostic
// so callers don't care about the backend.
//
// node-postgres returns bytea columns as Node Buffers, so getObjectBuffer can
// hand the value straight back to res.send / Meta upload / disk mirror.

const pool = require('../db');

const BACKEND = 'postgres';

// Defensive: create the storage table if it doesn't exist yet (mirrors the
// ensureTables() pattern used elsewhere). The migrations also create it.
async function ensureBucket() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coexistence.media_objects (
      object_key  TEXT PRIMARY KEY,
      data        BYTEA NOT NULL,
      mime_type   TEXT,
      size_bytes  BIGINT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function putObject(objectKey, buffer, mimeType) {
  await pool.query(
    `INSERT INTO coexistence.media_objects (object_key, data, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (object_key) DO UPDATE
       SET data = EXCLUDED.data,
           mime_type = EXCLUDED.mime_type,
           size_bytes = EXCLUDED.size_bytes`,
    [objectKey, buffer, mimeType || null, buffer.length]
  );
}

async function getObjectBuffer(objectKey) {
  const { rows } = await pool.query(
    `SELECT data FROM coexistence.media_objects WHERE object_key = $1`,
    [objectKey]
  );
  if (!rows.length) throw new Error(`Media object not found: ${objectKey}`);
  return rows[0].data; // bytea -> Buffer
}

async function removeObject(objectKey) {
  await pool.query(
    `DELETE FROM coexistence.media_objects WHERE object_key = $1`,
    [objectKey]
  ).catch(() => {});
}

function bucketName() { return BACKEND; }

module.exports = {
  ensureBucket,
  putObject,
  getObjectBuffer,
  removeObject,
  bucketName,
};
