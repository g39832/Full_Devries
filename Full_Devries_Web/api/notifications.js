const express = require('express');
const router = express.Router();
const db = require('./db');
const { asyncHandler, parseIntField } = require('./request-utils');
const { listNotifications, countUnread, markRead, markAllRead } = require('../services/notifications');

// ======================================================
// LIST NOTIFICATIONS (+ derived "needs attention" item)
// ======================================================
router.get('/', asyncHandler(async (req, res) => {
  const limit = req.query.limit ? parseIntField(req.query.limit, 'limit', { min: 1, max: 200 }) : 50;
  const notifications = await listNotifications({ limit });

  // Derived notification: jobs stuck in a pending state for 7+ days.
  let attention = null;
  try {
    await db.schemaReady;
    const { rows } = await db.query(`
      SELECT COUNT(*)::int AS n
      FROM jobs
      WHERE status IN ('Prospect', 'Pending Approval', 'Lead')
        AND created_at < (CURRENT_TIMESTAMP - INTERVAL '7 days')
    `);
    const n = Number(rows[0]?.n || 0);
    if (n > 0) {
      attention = {
        id: null,
        type: 'needs_attention',
        message: `${n} job${n === 1 ? '' : 's'} awaiting approval for over a week.`,
        entity_type: 'job',
        entity_id: null,
        client_id: null,
        job_id: null,
        is_read: false,
        created_at: new Date().toISOString(),
        derived: true
      };
    }
  } catch (err) {
    console.error('Attention query failed:', err.message);
  }

  if (attention) notifications.unshift(attention);
  return res.json({ success: true, notifications, unread: await countUnread() });
}));

// ======================================================
// UNREAD COUNT
// ======================================================
router.get('/unread-count', asyncHandler(async (req, res) => {
  return res.json({ success: true, unread: await countUnread() });
}));

// ======================================================
// MARK ONE READ
// ======================================================
router.post('/:id/read', asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await markRead(id);
  return res.json({ success: true, unread: await countUnread() });
}));

// ======================================================
// MARK ALL READ
// ======================================================
router.post('/read-all', asyncHandler(async (req, res) => {
  await markAllRead();
  return res.json({ success: true, unread: 0 });
}));

module.exports = router;
