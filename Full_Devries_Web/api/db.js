const path = require('path');
const Database = require('better-sqlite3');

const configuredDbPath = process.env.DB_PATH;
const dbPath = configuredDbPath
  ? (path.isAbsolute(configuredDbPath)
      ? configuredDbPath
      : path.resolve(__dirname, '..', configuredDbPath))
  : path.join(__dirname, '..', 'crm.db');
const db = new Database(dbPath);

// Keep database durability/safety defaults explicit.
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

function ensureColumn(tableName, columnName, columnDef) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((col) => col.name);
  if (!columns.includes(columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`).run();
  }
}

// =========================
// SETTINGS TABLE
// =========================
db.prepare(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`).run();

// =========================
// CLIENTS TABLE
// =========================
db.prepare(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    status TEXT DEFAULT 'Lead',
    total_due REAL DEFAULT 0,
    amount_paid REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_clients_created_at
  ON clients(created_at)
`).run();

// =========================
// PAYMENTS TABLE
// =========================
db.prepare(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_payments_client
  ON payments(client_id)
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_payments_date
  ON payments(payment_date)
`).run();

// =========================
// NOTES TABLE
// =========================
db.prepare(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_notes_client
  ON notes(client_id)
`).run();

// =========================
// FINANCE OVERRIDES TABLE
// =========================
db.prepare(`
  CREATE TABLE IF NOT EXISTS finance_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER UNIQUE,
    total_expected REAL DEFAULT 0,
    total_received REAL DEFAULT 0,
    total_remaining REAL DEFAULT 0,
    total_clients INTEGER DEFAULT 0,
    notes TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

ensureColumn('finance_overrides', 'year', 'INTEGER UNIQUE');
ensureColumn('finance_overrides', 'total_expected', 'REAL DEFAULT 0');
ensureColumn('finance_overrides', 'total_received', 'REAL DEFAULT 0');
ensureColumn('finance_overrides', 'total_remaining', 'REAL DEFAULT 0');
ensureColumn('finance_overrides', 'total_clients', 'INTEGER DEFAULT 0');
ensureColumn('finance_overrides', 'notes', 'TEXT');
ensureColumn('finance_overrides', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');

db.createBackup = async function createBackup(destinationPath) {
  return db.backup(destinationPath);
};

module.exports = db;
