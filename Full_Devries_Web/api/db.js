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
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

module.exports = db;

