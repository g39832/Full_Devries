const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runBackup } = require('../services/db-backup');

const backupDir = path.resolve(__dirname, '..', 'backups');
const prefix = 'crm-backup-';

function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.db'))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      return { name, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function verifyRestoredDb(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      throw new Error('Integrity check failed');
    }

    const requiredTables = ['settings', 'clients', 'payments', 'notes', 'finance_overrides'];
    const foundRows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?, ?, ?, ?)"
    ).all(...requiredTables);

    const found = new Set(foundRows.map((r) => r.name));
    const missing = requiredTables.filter((t) => !found.has(t));
    if (missing.length) {
      throw new Error(`Missing tables: ${missing.join(', ')}`);
    }

    db.prepare('SELECT COUNT(*) AS c FROM clients').get();
    db.prepare('SELECT COUNT(*) AS c FROM notes').get();
    db.prepare('SELECT COUNT(*) AS c FROM payments').get();
  } finally {
    db.close();
  }
}

async function main() {
  let backups = listBackups();
  if (!backups.length) {
    await runBackup({ retention: 30 });
    backups = listBackups();
  }

  if (!backups.length) {
    throw new Error('No backups available after backup creation attempt.');
  }

  const latest = backups[0];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devries-restore-'));
  const restorePath = path.join(tempDir, 'restored.db');

  try {
    fs.copyFileSync(latest.fullPath, restorePath);
    verifyRestoredDb(restorePath);
    console.log(`Backup restore verification passed: ${latest.name}`);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('Backup restore verification failed:', err.message);
  process.exit(1);
});
