const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { asyncHandler } = require('./request-utils');

const router = express.Router();

function requireHealthSecret(req, res, next) {
  const required = process.env.HEALTH_SECRET;
  if (!required) return next();
  const provided = req.headers['x-health-secret'] || '';
  if (provided === required) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized health check' });
}

function latestBackupInfo() {
  const backupsDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) return null;
  const files = fs.readdirSync(backupsDir)
    .filter((file) => file.startsWith('crm-backup-'))
    .map((file) => {
      const fullPath = path.join(backupsDir, file);
      return { file, mtime: fs.statSync(fullPath).mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;
  const latest = files[0];
  return { name: latest.file, timestamp: latest.mtime.toISOString() };
}

router.get('/', requireHealthSecret, asyncHandler(async (req, res) => {
  const timestamp = new Date().toISOString();
  await db.schemaReady;

  const clientsResult = await db.query('SELECT COUNT(*)::int AS total_clients FROM clients');
  const overdueResult = await db.query('SELECT COUNT(*)::int AS overdue_clients FROM clients WHERE balance > 0');
  const paymentsResult = await db.query('SELECT COUNT(*)::int AS payment_count, COALESCE(SUM(amount),0) AS total_received FROM payments');
  const todayResult = await db.query(`
    SELECT
      COUNT(*)::int AS new_clients,
      COALESCE(SUM(payments.amount), 0) AS today_payments
    FROM clients
    LEFT JOIN payments
      ON payments.client_id = clients.id
      AND DATE(payments.payment_date) = CURRENT_DATE
    WHERE DATE(clients.created_at) = CURRENT_DATE
  `);

  const clients = clientsResult.rows[0] || {};
  const overdue = overdueResult.rows[0] || {};
  const payments = paymentsResult.rows[0] || {};
  const today = todayResult.rows[0] || {};

  res.json({
    status: 'ok',
    timestamp,
    metrics: {
      totalClients: Number(clients.total_clients || 0),
      overdueClients: Number(overdue.overdue_clients || 0),
      paymentCount: Number(payments.payment_count || 0),
      totalReceived: Number(payments.total_received || 0),
      newClientsToday: Number(today.new_clients || 0),
      todayPayments: Number(today.today_payments || 0),
      lastBackup: latestBackupInfo()
    }
  });
}));

module.exports = router;