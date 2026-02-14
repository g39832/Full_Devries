// update-db.js
const Database = require('better-sqlite3');
const db = new Database('database.db');

console.log("Ensuring all necessary columns exist in clients table...");

// Add columns if they don't exist
try { db.prepare(`ALTER TABLE clients ADD COLUMN status TEXT DEFAULT 'Lead'`).run(); } catch {}
try { db.prepare(`ALTER TABLE clients ADD COLUMN address TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE clients ADD COLUMN notes TEXT`).run(); } catch {}

console.log("✅ Clients table updated!");
