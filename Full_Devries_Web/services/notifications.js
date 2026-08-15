// services/notifications.js
// In-app notifications (database-backed). Optional email delivery through the
// existing SMTP settings when EMAIL_NOTIFICATIONS_ENABLED=true — uses the same
// free SMTP sender the app already lets you configure (no paid service).
const db = require('../api/db');

async function createNotification({ type, message, entityType = 'job', entityId = null, clientId = null, jobId = null }) {
  try {
    await db.schemaReady;
    const { rows } = await db.query(`
      INSERT INTO notifications (type, message, entity_type, entity_id, client_id, job_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [String(type || 'info'), String(message || ''), entityType, entityId, clientId, jobId]);
    const id = rows[0]?.id;
    if (id) {
      // Fire-and-forget email delivery; never blocks the request.
      sendEmailNotification({ subject: `CRM notification: ${type}`, text: message }).catch(() => {});
    }
    return id;
  } catch (err) {
    console.error('createNotification failed:', err.message);
    return null;
  }
}

async function listNotifications({ limit = 50 } = {}) {
  await db.schemaReady;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await db.query(`
    SELECT id, type, message, entity_type, entity_id, client_id, job_id, is_read, created_at
    FROM notifications
    ORDER BY created_at DESC
    LIMIT $1
  `, [safeLimit]);
  return rows;
}

async function countUnread() {
  await db.schemaReady;
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM notifications WHERE is_read = false');
  return Number(rows[0]?.n || 0);
}

async function markRead(id) {
  await db.schemaReady;
  await db.query('UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
}

async function markAllRead() {
  await db.schemaReady;
  await db.query('UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE is_read = false');
}

// ======================================================
// OPTIONAL EMAIL DELIVERY (free SMTP, lazily loaded)
// ======================================================
async function sendEmailNotification({ subject = 'CRM notification', text = '' }) {
  if (process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'true') return false;

  const { normalizeEmailConfig, buildTransportOptions, formatFromAddress } = require('./email-config');
  const stored = await (async () => {
    const { rows } = await db.query("SELECT value FROM settings WHERE key = 'email_delivery_config'");
    if (!rows[0]?.value) return {};
    try { return JSON.parse(rows[0].value); } catch { return {}; }
  })();

  let transport;
  try {
    const nodemailer = require('nodemailer');
    const config = normalizeEmailConfig(stored);
    transport = nodemailer.createTransport(buildTransportOptions(config));
    await transport.sendMail({
      from: formatFromAddress(config) || config.fromEmail,
      to: String(process.env.NOTIFICATION_RECIPIENT_EMAIL || config.fromEmail || '').trim(),
      subject,
      text
    });
    return true;
  } catch (err) {
    console.warn('Email notification skipped:', err.message);
    return false;
  } finally {
    if (transport) transport.close();
  }
}

module.exports = {
  createNotification,
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
  sendEmailNotification
};
