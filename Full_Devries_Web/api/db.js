const Database = require('better-sqlite3');
const db = new Database('crm.db');

// ===== Existing Tables Stay Here =====


// ===== ADD SETTINGS TABLE (for password storage) =====
db.prepare(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`).run();

module.exports = db;
