// services/notifications.js
// In-app notifications (database-backed, per-user). Optional email delivery
// through the existing SMTP settings when EMAIL_NOTIFICATIONS_ENABLED=true.
//
// Recipient model:
//   * recipient_user_id = <user id>  → visible only to that user
//   * recipient_user_id = NULL       → broadcast, visible to everyone
// Read state lives in notification_reads (notification_id, user_id), so every
// user tracks their own unread count independently.
const db = require('../api/db');

function appBaseUrl() {
  return (process.env.APP_URL || '').replace(/\/+$/, '') || 'https://roofing-web.onrender.com';
}

async function createNotification({
  type, message, entityType = 'job', entityId = null, clientId = null, jobId = null,
  recipients = null, email = null, emailRecipients = null, emailText = null
}) {
  try {
    await db.schemaReady;
    const subject = `CRM notification: ${type}`;
    const emailBody = String(emailText || message || '');

    // Insert the in-app notification row (no email side effect).
    const insertInApp = async (recipientUserId) => {
      const { rows } = await db.query(`
        INSERT INTO notifications (type, message, entity_type, entity_id, client_id, job_id, recipient_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [String(type || 'info'), String(message || ''), entityType, entityId, clientId, jobId, recipientUserId]);
      return rows[0]?.id;
    };

    const emails = [];

    if (Array.isArray(emailRecipients) && emailRecipients.length) {
      // In-app goes to `recipients`; email goes ONLY to `emailRecipients`.
      const inAppRecipients = Array.isArray(recipients) ? recipients : [];
      for (const r of inAppRecipients) {
        const userId = r && r.id != null ? Number(r.id) : null;
        await insertInApp(userId);
      }
      for (const addr of emailRecipients) {
        const to = String(addr || '').trim();
        if (to) emails.push(to);
      }
    } else if (Array.isArray(recipients) && recipients.length) {
      // In-app + email to each recipient (default behavior).
      for (const r of recipients) {
        const userId = r && r.id != null ? Number(r.id) : null;
        await insertInApp(userId);
        if (r && r.email) emails.push(String(r.email).trim());
      }
    } else {
      // Broadcast in-app (visible to everyone) + optional single email.
      await insertInApp(null);
      const toEmail = email && String(email).trim();
      if (toEmail) emails.push(toEmail);
    }

    if (emails.length) {
      for (const to of emails) {
        sendEmailNotification({ subject, text: emailBody, to }).catch(() => {});
      }
    } else if (!Array.isArray(recipients) && !Array.isArray(emailRecipients)) {
      // Broadcast notification with no explicit recipient → the sender's own
      // inbox (sendEmailNotification falls back to the configured SMTP address).
      sendEmailNotification({ subject, text: emailBody, to: null }).catch(() => {});
    }
  } catch (err) {
    console.error('createNotification failed:', err.message);
    return null;
  }
}

async function listNotifications({ limit = 50, userId = null } = {}) {
  await db.schemaReady;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  if (userId == null) {
    const { rows } = await db.query(`
      SELECT id, type, message, entity_type, entity_id, client_id, job_id, recipient_user_id, is_read, created_at
      FROM notifications WHERE recipient_user_id IS NULL
      ORDER BY created_at DESC LIMIT $1
    `, [safeLimit]);
    return rows;
  }
  const uid = Number(userId);
  const { rows } = await db.query(`
    SELECT n.id, n.type, n.message, n.entity_type, n.entity_id, n.client_id, n.job_id, n.recipient_user_id, n.created_at,
           CASE WHEN nr.notification_id IS NULL THEN false ELSE true END AS is_read
    FROM notifications n
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $2
    WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = $2)
    ORDER BY n.created_at DESC
    LIMIT $1
  `, [safeLimit, uid]);
  return rows;
}

async function countUnread(userId = null) {
  await db.schemaReady;
  if (userId == null) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE recipient_user_id IS NULL AND is_read = false'
    );
    return Number(rows[0]?.n || 0);
  }
  const uid = Number(userId);
  const { rows } = await db.query(`
    SELECT COUNT(*)::int AS n
    FROM notifications n
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
    WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = $1)
      AND nr.notification_id IS NULL
  `, [uid]);
  return Number(rows[0]?.n || 0);
}

async function markRead(id, userId = null) {
  await db.schemaReady;
  if (userId != null) {
    await db.query(`
      INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2)
      ON CONFLICT (notification_id, user_id) DO NOTHING
    `, [id, Number(userId)]);
  } else {
    await db.query('UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  }
}

async function markAllRead(userId = null) {
  await db.schemaReady;
  if (userId != null) {
    await db.query(`
      INSERT INTO notification_reads (notification_id, user_id)
      SELECT n.id, $1 FROM notifications n
      WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = $1)
        AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = $1)
      ON CONFLICT DO NOTHING
    `, [Number(userId)]);
  } else {
    await db.query('UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE is_read = false');
  }
}

// ======================================================
// OPTIONAL EMAIL DELIVERY (free SMTP, lazily loaded)
// ======================================================
async function sendEmailNotification({ subject = 'CRM notification', text = '', to = null, html = null }) {
  const { normalizeEmailConfig, buildTransportOptions, formatFromAddress } = require('./email-config');

  const stored = await (async () => {
    const { rows } = await db.query("SELECT value FROM settings WHERE key = 'email_delivery_config'");
    if (!rows[0]?.value) return {};
    try { return JSON.parse(rows[0].value); } catch { return {}; }
  })();

  const config = normalizeEmailConfig(stored);
  const smtpConfigured = Boolean(config.smtpUser && config.smtpPassword);

  // Emails send automatically once a complete SMTP profile is saved in the
  // app's Email Setup modal. EMAIL_NOTIFICATIONS_ENABLED overrides:
  //   'true'  → always send (e.g. SMTP supplied via EMAIL_USER/EMAIL_PASS env vars)
  //   'false' → force-disable even when SMTP is configured
  //   unset   → send when SMTP is configured
  const envFlag = String(process.env.EMAIL_NOTIFICATIONS_ENABLED || '').trim().toLowerCase();
  const enabled = envFlag === 'true' || (envFlag === '' && smtpConfigured);
  if (!enabled) return false;

  let transport;
  try {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport(buildTransportOptions(config));
    const toAddress = String(to || process.env.NOTIFICATION_RECIPIENT_EMAIL || config.fromEmail || '').trim();
    if (!toAddress) return false;
    await transport.sendMail({
      from: formatFromAddress(config) || config.fromEmail,
      to: toAddress,
      subject,
      text,
      html
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
  sendEmailNotification,
  appBaseUrl
};
