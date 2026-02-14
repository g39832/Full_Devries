// init-db.js
const Database = require('better-sqlite3');
const db = new Database('crm.db');

console.log("Initializing database...");

// Drop old table if exists
db.prepare(`DROP TABLE IF EXISTS clients`).run();

// Create clients table with correct columns
db.prepare(`
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Lead',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

console.log("✅ Database initialized!");
