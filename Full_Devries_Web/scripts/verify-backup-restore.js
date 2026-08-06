const fs = require('fs');
const path = require('path');

// Load .env early so the safety guard below can see TEST_DATABASE_URL
// before api/db.js is required.
try {
  require('dotenv').config();
} catch (_) {}

// ============================================================
// SAFETY GUARD: never run against the production database
// unless the operator explicitly opts in. Backups are full DB
// snapshots, so verifying against production data is only
// meaningful on a dedicated test database.
//
// IMPORTANT: this must run BEFORE requiring ../api/db, because
// api/db.js resolves its connection string at module-load time
// (it checks NODE_ENV === 'test' then).
// ============================================================
if (process.env.BACKUP_ALLOW_PRODUCTION !== 'true') {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      'Refusing to run backup verification against DATABASE_URL (production).\n' +
      'Set TEST_DATABASE_URL to a dedicated test database, or set ' +
      'BACKUP_ALLOW_PRODUCTION=true to explicitly allow it.'
    );
  }
  process.env.NODE_ENV = 'test';
}

const { runBackup } = require('../services/db-backup');
const db = require('../api/db');

const backupDir = path.resolve(__dirname, '..', 'backups');
const prefix = 'crm-backup-';

function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      return { name, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function verifyBackupJson(fullPath) {
  const raw = fs.readFileSync(fullPath, 'utf8');
  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Backup is not valid JSON: ${err.message}`);
  }

  if (!snapshot || typeof snapshot !== 'object' || !snapshot.createdAt) {
    throw new Error('Backup is missing createdAt metadata');
  }

  const requiredTables = ['settings', 'clients', 'payments', 'notes', 'finance_overrides'];
  const tables = snapshot.tables || {};
  const missing = requiredTables.filter((t) => !Array.isArray(tables[t]));
  if (missing.length) {
    throw new Error(`Backup missing tables: ${missing.join(', ')}`);
  }

  // Basic shape checks on each table's rows
  for (const table of requiredTables) {
    for (const row of tables[table]) {
      if (!row || typeof row !== 'object') {
        throw new Error(`Backup table ${table} contains a non-object row`);
      }
    }
  }

  return {
    createdAt: snapshot.createdAt,
    clients: tables.clients.length,
    payments: tables.payments.length,
    notes: tables.notes.length,
    settings: tables.settings.length
  };
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
  const counts = verifyBackupJson(latest.fullPath);
  console.log(
    `Backup restore verification passed: ${latest.name} ` +
    `(clients=${counts.clients}, payments=${counts.payments}, notes=${counts.notes}, settings=${counts.settings})`
  );
}

main()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error('Backup restore verification failed:', err.message);
    process.exit(1);
  });
