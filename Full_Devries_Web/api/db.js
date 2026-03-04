const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const slowQueryMs = Number(process.env.DB_SLOW_QUERY_MS || 250);

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: envInt('DB_POOL_MAX', 20),
  idleTimeoutMillis: envInt('DB_IDLE_TIMEOUT_MS', 30000),
  connectionTimeoutMillis: envInt('DB_CONNECT_TIMEOUT_MS', 10000),
  keepAlive: true,
  statement_timeout: envInt('DB_STATEMENT_TIMEOUT_MS', 15000),
  query_timeout: envInt('DB_QUERY_TIMEOUT_MS', 15000),
});

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration >= slowQueryMs) {
      const compactSql = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      console.warn(`[DB][slow ${duration}ms] ${compactSql}`);
    }
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    const compactSql = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    console.error(`[DB][error ${duration}ms] ${compactSql}`);
    throw err;
  }
}

async function initSchema() {
  // SETTINGS
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // CLIENTS
  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      status TEXT DEFAULT 'Lead',
      total_due DOUBLE PRECISION DEFAULT 0,
      amount_paid DOUBLE PRECISION DEFAULT 0,
      balance DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_clients_created_at
    ON clients(created_at);
  `);

  // PAYMENTS
  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      amount DOUBLE PRECISION NOT NULL,
      payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_payments_client
    ON payments(client_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_payments_date
    ON payments(payment_date);
  `);

  // NOTES
  await query(`
    CREATE TABLE IF NOT EXISTS notes (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_notes_client
    ON notes(client_id);
  `);

  // FINANCE OVERRIDES
  await query(`
    CREATE TABLE IF NOT EXISTS finance_overrides (
      id BIGSERIAL PRIMARY KEY,
      year INTEGER UNIQUE,
      total_expected DOUBLE PRECISION DEFAULT 0,
      total_received DOUBLE PRECISION DEFAULT 0,
      total_remaining DOUBLE PRECISION DEFAULT 0,
      total_clients INTEGER DEFAULT 0,
      notes TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

const schemaReady = initSchema().catch((err) => {
  console.error('Failed to initialize database schema:', err);
  throw err;
});

module.exports = {
  pool,
  query,
  schemaReady,
};
