const fs = require('fs');
const path = require('path');
const db = require('../api/db');

const backupRoot = path.resolve(__dirname, '..', 'backups');
const backupPrefix = 'crm-backup-';

function getTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function ensureBackupDir() {
  if (!fs.existsSync(backupRoot)) {
    fs.mkdirSync(backupRoot, { recursive: true });
  }
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(backupRoot)
    .filter((name) => name.startsWith(backupPrefix) && name.endsWith('.json'))
    .map((name) => ({
      name,
      fullPath: path.join(backupRoot, name),
      mtimeMs: fs.statSync(path.join(backupRoot, name)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneBackups(maxBackups) {
  const backups = listBackups();
  if (backups.length <= maxBackups) return;

  backups.slice(maxBackups).forEach((file) => {
    try {
      fs.unlinkSync(file.fullPath);
    } catch (err) {
      console.error(`Backup prune failed for ${file.name}:`, err.message);
    }
  });
}

async function runBackup({ retention = 30 } = {}) {
  ensureBackupDir();
  await db.schemaReady;

  const tables = ['settings', 'clients', 'payments', 'notes', 'finance_overrides'];
  const snapshot = {
    createdAt: new Date().toISOString(),
    tables: {}
  };

  for (const table of tables) {
    const { rows } = await db.query(`SELECT * FROM ${table}`);
    snapshot.tables[table] = rows;
  }

  const fileName = `${backupPrefix}${getTimestamp()}.json`;
  const destination = path.join(backupRoot, fileName);
  fs.writeFileSync(destination, JSON.stringify(snapshot, null, 2), 'utf8');

  pruneBackups(retention);
  console.log(`Database backup created: ${fileName}`);
}

function startBackupScheduler() {
  const intervalHours = Number(process.env.DB_BACKUP_INTERVAL_HOURS || 12);
  const retention = Number(process.env.DB_BACKUP_RETENTION || 30);
  const initialDelayMs = Number(process.env.DB_BACKUP_INITIAL_DELAY_MS || 120000);
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

  setTimeout(() => {
    runBackup({ retention }).catch((err) => {
      console.error('Initial database backup failed:', err.message);
    });
  }, Math.max(0, initialDelayMs)).unref();

  const timer = setInterval(() => {
    runBackup({ retention }).catch((err) => {
      console.error('Scheduled database backup failed:', err.message);
    });
  }, intervalMs);

  timer.unref();
  console.log(`Database backup scheduler enabled: interval=${intervalHours}h retention=${retention}`);
}

module.exports = {
  startBackupScheduler,
  runBackup
};