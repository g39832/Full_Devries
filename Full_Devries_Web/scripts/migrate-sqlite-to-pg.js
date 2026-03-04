const path = require('path');
const sqlite3 = require('sqlite3');
const fs = require('fs');

function loadEnvFallback() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch {
  loadEnvFallback();
}

const pgDb = require('../api/db');

const sqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(__dirname, '..', 'crm.db');

function openSqlite(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function sqliteClose(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function migrate() {
  console.log(`Using SQLite source: ${sqlitePath}`);
  const sqliteDb = await openSqlite(sqlitePath);

  try {
    const [settings, clients, payments, notes, financeOverridesRaw] = await Promise.all([
      sqliteAll(sqliteDb, 'SELECT key, value FROM settings'),
      sqliteAll(sqliteDb, 'SELECT id, name, phone, email, address, status, total_due, amount_paid, balance, created_at FROM clients'),
      sqliteAll(sqliteDb, 'SELECT id, client_id, amount, payment_date FROM payments'),
      sqliteAll(sqliteDb, 'SELECT id, client_id, content, created_at FROM notes'),
      sqliteAll(sqliteDb, `
        SELECT
          year,
          totalExpected,
          totalReceived,
          totalRemaining,
          totalClients,
          total_expected,
          total_received,
          total_remaining,
          total_clients,
          notes,
          updated_at
        FROM finance_overrides
      `)
    ]);

    const financeOverrides = financeOverridesRaw.map((row) => ({
      year: row.year,
      total_expected: row.total_expected ?? row.totalExpected ?? 0,
      total_received: row.total_received ?? row.totalReceived ?? 0,
      total_remaining: row.total_remaining ?? row.totalRemaining ?? 0,
      total_clients: row.total_clients ?? row.totalClients ?? 0,
      notes: row.notes ?? null,
      updated_at: row.updated_at ?? null
    }));

    console.log('SQLite row counts:', {
      settings: settings.length,
      clients: clients.length,
      payments: payments.length,
      notes: notes.length,
      finance_overrides: financeOverrides.length
    });

    await pgDb.schemaReady;
    const client = await pgDb.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query('TRUNCATE TABLE notes, payments, finance_overrides, settings, clients RESTART IDENTITY CASCADE');

      for (const row of settings) {
        await client.query(
          `INSERT INTO settings (key, value)
           VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [row.key, row.value]
        );
      }

      for (const row of clients) {
        await client.query(
          `INSERT INTO clients (id, name, phone, email, address, status, total_due, amount_paid, balance, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             email = EXCLUDED.email,
             address = EXCLUDED.address,
             status = EXCLUDED.status,
             total_due = EXCLUDED.total_due,
             amount_paid = EXCLUDED.amount_paid,
             balance = EXCLUDED.balance,
             created_at = EXCLUDED.created_at`,
          [
            row.id,
            row.name,
            row.phone,
            row.email,
            row.address,
            row.status,
            row.total_due,
            row.amount_paid,
            row.balance,
            row.created_at
          ]
        );
      }

      for (const row of payments) {
        await client.query(
          `INSERT INTO payments (id, client_id, amount, payment_date)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             client_id = EXCLUDED.client_id,
             amount = EXCLUDED.amount,
             payment_date = EXCLUDED.payment_date`,
          [row.id, row.client_id, row.amount, row.payment_date]
        );
      }

      for (const row of notes) {
        await client.query(
          `INSERT INTO notes (id, client_id, content, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             client_id = EXCLUDED.client_id,
             content = EXCLUDED.content,
             created_at = EXCLUDED.created_at`,
          [row.id, row.client_id, row.content, row.created_at]
        );
      }

      for (const row of financeOverrides) {
        if (row.year === null || row.year === undefined || row.year === '') continue;
        await client.query(
          `INSERT INTO finance_overrides
             (year, total_expected, total_received, total_remaining, total_clients, notes, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamp, CURRENT_TIMESTAMP))
           ON CONFLICT (year) DO UPDATE SET
             total_expected = EXCLUDED.total_expected,
             total_received = EXCLUDED.total_received,
             total_remaining = EXCLUDED.total_remaining,
             total_clients = EXCLUDED.total_clients,
             notes = EXCLUDED.notes,
             updated_at = EXCLUDED.updated_at`,
          [
            row.year,
            row.total_expected,
            row.total_received,
            row.total_remaining,
            row.total_clients,
            row.notes,
            row.updated_at
          ]
        );
      }

      await client.query(`SELECT setval(pg_get_serial_sequence('clients', 'id'), COALESCE((SELECT MAX(id) FROM clients), 1), true)`);
      await client.query(`SELECT setval(pg_get_serial_sequence('payments', 'id'), COALESCE((SELECT MAX(id) FROM payments), 1), true)`);
      await client.query(`SELECT setval(pg_get_serial_sequence('notes', 'id'), COALESCE((SELECT MAX(id) FROM notes), 1), true)`);
      await client.query(`SELECT setval(pg_get_serial_sequence('finance_overrides', 'id'), COALESCE((SELECT MAX(id) FROM finance_overrides), 1), true)`);

      await client.query('COMMIT');

      const counts = {};
      for (const table of ['settings', 'clients', 'payments', 'notes', 'finance_overrides']) {
        const result = await client.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
        counts[table] = result.rows[0].c;
      }

      console.log('PostgreSQL row counts after migration:', counts);
      console.log('Migration completed successfully.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await sqliteClose(sqliteDb);
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
