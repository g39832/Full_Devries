const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const router = express.Router();

function requireHealthSecret(req, res, next) {
  const required = process.env.HEALTH_SECRET;
  if (!required) return next();
  const provided = req.headers['x-health-secret'] || '';
  if (provided === required) return next();
  res.status(401).json({ success: false, error: 'Unauthorized health check' });
}

function latestBackupInfo() {
  const backupsDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) return null;
  const files = fs.readdirSync(backupsDir)
    .filter(file => file.startsWith('crm-backup-') && file.endsWith('.db'))
    .map(file => {
      const fullPath = path.join(backupsDir, file);
      return { file, mtime: fs.statSync(fullPath).mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;
  const latest = files[0];
  return { name: latest.file, timestamp: latest.mtime.toISOString() };
}

router.get('/', requireHealthSecret, (req, res) => {
  const timestamp = new Date().toISOString();
  const clients = db.prepare('SELECT COUNT(*) AS totalClients FROM clients').get();
  const overdue = db.prepare('SELECT COUNT(*) AS overdueClients FROM clients WHERE balance > 0').get();
  const payments = db.prepare('SELECT COUNT(*) AS paymentCount, COALESCE(SUM(amount),0) AS totalReceived FROM payments').get();
  const today = db.prepare(`
    SELECT COUNT(*) AS newClients,
      COALESCE(SUM(payments.amount), 0) AS todayPayments
    FROM clients
    LEFT JOIN payments ON payments.client_id = clients.id AND DATE(payments.payment_date) = DATE('now')
    WHERE DATE(clients.created_at) = DATE('now')
  `).get();

  res.json({
    status: 'ok',
    timestamp,
    metrics: {
      totalClients: clients?.totalClients || 0,
      overdueClients: overdue?.overdueClients || 0,
      paymentCount: payments?.paymentCount || 0,
      totalReceived: payments?.totalReceived || 0,
      newClientsToday: today?.newClients || 0,
      todayPayments: today?.todayPayments || 0,
      lastBackup: latestBackupInfo()
    }
  });
});

module.exports = router;
