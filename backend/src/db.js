const { Pool } = require('pg');

function buildPool() {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new Pool({
      connectionString,
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      application_name: 'forgecrm-backend',
    });
  }

  // Fallback to individual env vars (Docker Compose pattern)
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'forgecrm-backend',
  });
}

const pool = buildPool();

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

module.exports = pool;
