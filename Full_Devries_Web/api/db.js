/**
 * db.js — Supabase-backed database layer
 *
 * Replaces the local PostgreSQL pool with Supabase's postgres connection
 * so all data is stored in the cloud and accessible from any device.
 *
 * The DATABASE_URL env var should point to your Supabase postgres connection
 * string (found in Supabase → Settings → Database → Connection string → URI).
 */
const { Pool } = require('pg');

const connectionString = process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;

// SSL handling: Supabase requires TLS; fully local Postgres (embedded-postgres
// or a local install) does not. Respect an explicit sslmode, otherwise disable
// TLS for loopback hosts so local testing works out of the box.
function resolveSsl(url) {
  const sslMode = /[?&]sslmode=([^&]+)/.exec(url || '');
  if (sslMode) {
    const mode = sslMode[1].toLowerCase();
    if (mode === 'disable') return false;
    return { rejectUnauthorized: false };
  }
  try {
    const hostname = new URL(url).hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return false;
    }
  } catch (_) { /* non-URL connection strings keep TLS */ }
  return { rejectUnauthorized: false };
}

const slowQueryMs = Number(process.env.DB_SLOW_QUERY_MS || 250);

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required. Set it to your Supabase postgres connection string.');
}

const pool = new Pool({
  connectionString,
  ssl: resolveSsl(connectionString),
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

  // CLIENTS — full schema including all fields
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
      scope_of_work TEXT DEFAULT '',
      job_cost DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add columns if they don't exist yet (safe for existing DBs)
  const alterColumns = [
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS scope_of_work TEXT DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS job_cost DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS amount_paid DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS balance DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Lead'`,
  ];
  for (const sql of alterColumns) {
    await query(sql).catch(() => {}); // ignore if already exists
  }

  await query(`CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients(created_at);`);

  // PAYMENTS
  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      amount DOUBLE PRECISION NOT NULL,
      payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);`);

  // NOTES
  await query(`
    CREATE TABLE IF NOT EXISTS notes (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_notes_client ON notes(client_id);`);

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

  // MARGIN TRACKER
  await query(`
    CREATE TABLE IF NOT EXISTS finance_margin_entries (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
      client_name TEXT DEFAULT '',
      category TEXT DEFAULT 'Misc',
      project TEXT DEFAULT '',
      invoice_status TEXT DEFAULT 'Pending',
      amount DOUBLE PRECISION DEFAULT 0,
      expense_type TEXT DEFAULT 'one-time',
      recurring BOOLEAN DEFAULT false,
      expense_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes TEXT DEFAULT '',
      attachment_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ==================================================================
  // JOBS (Client 1 ── many Jobs)
  // ==================================================================
  await query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'Prospect',
      address TEXT DEFAULT '',
      scope_of_work TEXT DEFAULT '',
      job_cost DOUBLE PRECISION DEFAULT 0,
      total_due DOUBLE PRECISION DEFAULT 0,
      amount_paid DOUBLE PRECISION DEFAULT 0,
      balance DOUBLE PRECISION DEFAULT 0,
      legacy_storage_key TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);`);

  // Backfill: one default Job per existing client that doesn't have one yet
  // (idempotent + self-healing). Job-level fields move onto the Job row.
  await query(`
    INSERT INTO jobs (client_id, name, status, address, scope_of_work, job_cost, total_due, amount_paid, balance, legacy_storage_key, created_at)
    SELECT
      c.id, c.name,
      COALESCE(NULLIF(TRIM(c.status), ''), 'Prospect'),
      COALESCE(c.address, ''),
      COALESCE(c.scope_of_work, ''),
      COALESCE(c.job_cost, 0),
      COALESCE(c.total_due, 0),
      COALESCE(c.amount_paid, 0),
      GREATEST(0, COALESCE(c.total_due, 0) - COALESCE(c.amount_paid, 0)),
      c.id::text,
      COALESCE(c.created_at, CURRENT_TIMESTAMP)
    FROM clients c
    WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.client_id = c.id)
  `);

  // Link existing records to their client's default job.
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS job_id BIGINT;`);
  await query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS job_id BIGINT;`);
  await query(`ALTER TABLE finance_margin_entries ADD COLUMN IF NOT EXISTS job_id BIGINT;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_payments_job ON payments(job_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notes_job ON notes(job_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_margin_entries_job ON finance_margin_entries(job_id);`);

  await query(`
    UPDATE payments p SET job_id = j.id
    FROM jobs j WHERE j.client_id = p.client_id AND p.job_id IS NULL
  `);
  await query(`
    UPDATE notes n SET job_id = j.id
    FROM jobs j WHERE j.client_id = n.client_id AND n.job_id IS NULL
  `);
  await query(`
    UPDATE finance_margin_entries e SET job_id = j.id
    FROM jobs j WHERE j.client_id = e.client_id AND e.job_id IS NULL
  `);
  await query(`UPDATE jobs SET balance = GREATEST(0, total_due - amount_paid) WHERE balance < 0;`);

  // ==================================================================
  // TAGS (database-backed, case-insensitive unique)
  // ==================================================================
  await query(`
    CREATE TABLE IF NOT EXISTS tags (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_lower ON tags (lower(name));`);
  await query(`
    CREATE TABLE IF NOT EXISTS job_tags (
      job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, tag_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_job_tags_tag ON job_tags(tag_id);`);

  // ==================================================================
  // APP USERS (Normal User vs Admin)
  // ==================================================================
  await query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT DEFAULT '',
      google_id TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_google_id ON app_users (google_id) WHERE google_id IS NOT NULL;`);

  // ==================================================================
  // FINANCE ADJUSTMENTS (admin override audit trail)
  // ==================================================================
  await query(`
    CREATE TABLE IF NOT EXISTS finance_adjustments (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
      job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
      record_type TEXT NOT NULL,
      record_id BIGINT,
      field_name TEXT DEFAULT '',
      old_value DOUBLE PRECISION,
      new_value DOUBLE PRECISION,
      reason TEXT DEFAULT '',
      adjusted_by TEXT DEFAULT '',
      adjusted_by_name TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_finance_adjustments_job ON finance_adjustments(job_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_finance_adjustments_created ON finance_adjustments(created_at DESC);`);

  // ==================================================================
  // NOTIFICATIONS (in-app)
  // ==================================================================
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT DEFAULT 'job',
      entity_id BIGINT,
      client_id BIGINT,
      job_id BIGINT,
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);`);

  // ==================================================================
  // ACTIVITY LOG (admin "who did what" audit trail)
  // ==================================================================
  await query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id BIGSERIAL PRIMARY KEY,
      actor_email TEXT NOT NULL,
      actor_name TEXT DEFAULT '',
      actor_role TEXT DEFAULT 'user',
      action TEXT NOT NULL,
      method TEXT DEFAULT '',
      path TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_activity_log_actor ON activity_log(actor_email);`);

  // ==================================================================
  // V3 — Sales assignment, two tag kinds, line items, note authors,
  // per-user notifications (additive + idempotent)
  // ==================================================================
  await query(`ALTER TABLE tags ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'job';`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_tag_id BIGINT;`);
  await query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sales_user_id BIGINT;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_sales_user ON jobs(sales_user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_clients_primary_tag ON clients(primary_tag_id);`);

  await query(`
    CREATE TABLE IF NOT EXISTS job_line_items (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      description TEXT NOT NULL DEFAULT '',
      quantity DOUBLE PRECISION DEFAULT 1,
      unit_price DOUBLE PRECISION DEFAULT 0,
      amount DOUBLE PRECISION DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_job_line_items_job ON job_line_items(job_id);`);

  await query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS author_user_id BIGINT;`);
  await query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS author_name TEXT DEFAULT '';`);
  await query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS author_email TEXT DEFAULT '';`);

  await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_user_id BIGINT;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id);`);

  await query(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL,
      read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notification_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);`);

  // ==================================================================
  // FINANCE OVERHEAD — yearly overhead cost for the dashboard
  // ==================================================================
  await query(`ALTER TABLE finance_overrides ADD COLUMN IF NOT EXISTS overhead DOUBLE PRECISION DEFAULT 0;`);

  // ==================================================================
  // TRIGGERS — keep legacy client finance cache + job balances consistent
  // ==================================================================
  await query(`
    CREATE OR REPLACE FUNCTION refresh_job_finance_from_payments() RETURNS trigger AS $$
    DECLARE
      affected_job BIGINT;
    BEGIN
      affected_job := COALESCE(NEW.job_id, OLD.job_id);
      IF affected_job IS NOT NULL THEN
        UPDATE jobs j SET
          amount_paid = COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.job_id = j.id), 0),
          balance = GREATEST(0, j.total_due - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.job_id = j.id), 0))
        WHERE j.id = affected_job;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await query(`DROP TRIGGER IF EXISTS trg_payments_refresh_job ON payments;`);
  await query(`CREATE TRIGGER trg_payments_refresh_job AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION refresh_job_finance_from_payments();`);

  await query(`
    CREATE OR REPLACE FUNCTION refresh_job_balance() RETURNS trigger AS $$
    BEGIN
      NEW.balance := GREATEST(0, NEW.total_due - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.job_id = NEW.id), 0));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await query(`DROP TRIGGER IF EXISTS trg_jobs_balance ON jobs;`);
  await query(`CREATE TRIGGER trg_jobs_balance BEFORE UPDATE OF total_due ON jobs FOR EACH ROW EXECUTE FUNCTION refresh_job_balance();`);

  await query(`
    CREATE OR REPLACE FUNCTION refresh_client_finance_cache() RETURNS trigger AS $$
    DECLARE
      affected_client BIGINT;
    BEGIN
      affected_client := COALESCE(NEW.client_id, OLD.client_id);
      IF affected_client IS NOT NULL THEN
        UPDATE clients c SET
          total_due = COALESCE((SELECT SUM(j.total_due) FROM jobs j WHERE j.client_id = c.id), 0),
          amount_paid = COALESCE((SELECT SUM(j.amount_paid) FROM jobs j WHERE j.client_id = c.id), 0),
          balance = GREATEST(0, COALESCE((SELECT SUM(j.balance) FROM jobs j WHERE j.client_id = c.id), 0)),
          job_cost = COALESCE((SELECT SUM(j.job_cost) FROM jobs j WHERE j.client_id = c.id), 0)
        WHERE c.id = affected_client;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await query(`DROP TRIGGER IF EXISTS trg_jobs_refresh_client ON jobs;`);
  await query(`CREATE TRIGGER trg_jobs_refresh_client AFTER INSERT OR UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION refresh_client_finance_cache();`);

  // One-time client cache refresh (idempotent — re-sums from jobs).
  await query(`
    UPDATE clients c SET
      total_due = COALESCE((SELECT SUM(j.total_due) FROM jobs j WHERE j.client_id = c.id), 0),
      amount_paid = COALESCE((SELECT SUM(j.amount_paid) FROM jobs j WHERE j.client_id = c.id), 0),
      balance = GREATEST(0, COALESCE((SELECT SUM(j.balance) FROM jobs j WHERE j.client_id = c.id), 0)),
      job_cost = COALESCE((SELECT SUM(j.job_cost) FROM jobs j WHERE j.client_id = c.id), 0)
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
