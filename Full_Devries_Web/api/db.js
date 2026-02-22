const path = require('path');
const Database = require('better-sqlite3');

/*
  IMPORTANT:
  This forces the database file to always live
  in the ROOT of your project folder,
  not inside /api
*/

const dbPath = path.join(__dirname, '..', 'crm.db');
const db = new Database(dbPath);

// Enable foreign keys (IMPORTANT for relational integrity)
db.pragma('foreign_keys = ON');

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

module.exports = db;