const express = require('express');
const db = require('./db');
const { asyncHandler, assertObject, parseIntField, parseStringField } = require('./request-utils');
const { getSessionUser } = require('./auth');
const { requireJobAccess, requireClientAccess } = require('./authz');
const { createNotification, appBaseUrl } = require('../services/notifications');

const router = express.Router();

// Note emails go only to the owner (Chase), never to every admin/sales user.
// Set NOTE_EMAIL_RECIPIENTS (comma-separated) to override.
const NOTE_EMAIL_RECIPIENTS = (process.env.NOTE_EMAIL_RECIPIENTS || 'devriesbrothersroofing@gmail.com')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

// ======================================================
// NOTE AUTHOR + NOTIFICATION HELPERS
// ======================================================
async function noteRecipients({ jobId = null, clientId = null }) {
  await db.schemaReady;
  const recipients = new Map();
  const collect = (rows) => rows.forEach((r) => {
    if (r && r.id != null) recipients.set(Number(r.id), r);
  });

  if (jobId) {
    const job = await db.query('SELECT sales_user_id FROM jobs WHERE id = $1', [jobId]);
    const salesId = job.rows[0]?.sales_user_id;
    if (salesId) {
      collect((await db.query('SELECT id, email FROM app_users WHERE id = $1', [salesId])).rows);
    }
  } else if (clientId) {
    collect((await db.query(
      'SELECT DISTINCT u.id, u.email FROM jobs j JOIN app_users u ON u.id = j.sales_user_id WHERE j.client_id = $1 AND j.sales_user_id IS NOT NULL',
      [clientId]
    )).rows);
  }
  collect((await db.query("SELECT id, email FROM app_users WHERE role = 'admin' AND is_active = true")).rows);
  return [...recipients.values()];
}

async function notifyNoteAdded({ author, clientName, jobName, preview, jobId, clientId }) {
  try {
    const recipients = await noteRecipients({ jobId, clientId });
    const link = `${appBaseUrl()}/main?${jobId ? `job=${jobId}` : `client=${clientId}`}`;
    const message = `${author.name || author.email} added a note${jobName ? ` on "${jobName}"` : ''} for ${clientName}.`;
    const text = [
      `${author.name || author.email} added a note${jobName ? ` on job "${jobName}"` : ''} for ${clientName}.`,
      '',
      preview,
      '',
      `Time: ${new Date().toLocaleString('en-US')}`,
      `Open in CRM: ${link}`,
    ].join('\n');

    await createNotification({
      type: 'note',
      message,
      entityType: jobId ? 'job' : 'client',
      entityId: jobId || clientId,
      clientId,
      jobId,
      // In-app: assigned sales person + admins. Email: only the owner (Chase).
      recipients: recipients.map((r) => ({ id: r.id, email: r.email })),
      emailRecipients: NOTE_EMAIL_RECIPIENTS,
      emailText: text
    });
  } catch (err) {
    console.error('Note notification failed:', err.message);
  }
}

// ======================================================
// CLIENT-SCOPED NOTES
// ======================================================
router.get('/list/:clientId', requireClientAccess(), asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(
    'SELECT id, content, author_name, author_email, created_at FROM notes WHERE client_id = $1 AND job_id IS NULL ORDER BY created_at ASC',
    [clientId]
  );
  res.json({ notes: rows });
}));

router.post('/add/:clientId', requireClientAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });
  const author = getSessionUser(req);

  await db.schemaReady;
  const client = await db.query('SELECT name FROM clients WHERE id = $1', [clientId]);
  const clientName = client.rows[0]?.name || 'Client';

  const { rows } = await db.query(
    'INSERT INTO notes (client_id, content, author_user_id, author_name, author_email) VALUES ($1, $2, $3, $4, $5) RETURNING id, content, author_name, author_email, created_at',
    [clientId, note, author ? Number(author.id) : null, author?.name || '', author?.email || '']
  );

  await notifyNoteAdded({ author, clientName, jobName: null, preview: note, jobId: null, clientId });
  res.json({ note: rows[0] });
}));

router.delete('/delete/:clientId/:noteId', requireClientAccess(), asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  await db.schemaReady;
  await db.query('DELETE FROM notes WHERE id = $1 AND client_id = $2', [noteId, clientId]);
  res.json({ success: true });
}));

router.put('/update/:clientId/:noteId', requireClientAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  await db.query('UPDATE notes SET content = $1 WHERE id = $2 AND client_id = $3', [note, noteId, clientId]);
  const { rows } = await db.query(
    'SELECT id, content, author_name, author_email, created_at FROM notes WHERE id = $1',
    [noteId]
  );
  res.json({ note: rows[0] || null });
}));

// ======================================================
// JOB-SCOPED NOTES (each Job holds its own notes)
// ======================================================
router.get('/job/:jobId', requireJobAccess(), asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(
    'SELECT id, content, author_name, author_email, created_at FROM notes WHERE job_id = $1 ORDER BY created_at ASC',
    [jobId]
  );
  res.json({ notes: rows });
}));

router.post('/job/:jobId', requireJobAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });
  const author = getSessionUser(req);

  await db.schemaReady;
  const jobResult = await db.query(
    'SELECT j.client_id, j.name, c.name AS client_name FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.id = $1',
    [jobId]
  );
  if (!jobResult.rows[0]) return res.status(404).json({ error: 'Job not found' });
  const job = jobResult.rows[0];

  const { rows } = await db.query(
    'INSERT INTO notes (client_id, job_id, content, author_user_id, author_name, author_email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, content, author_name, author_email, created_at',
    [job.client_id, jobId, note, author ? Number(author.id) : null, author?.name || '', author?.email || '']
  );

  await notifyNoteAdded({
    author, clientName: job.client_name, jobName: job.name, preview: note, jobId, clientId: job.client_id
  });
  res.json({ note: rows[0] });
}));

router.put('/job/:jobId/:noteId', requireJobAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  await db.query('UPDATE notes SET content = $1 WHERE id = $2 AND job_id = $3', [note, noteId, jobId]);
  res.json({ success: true });
}));

router.delete('/job/:jobId/:noteId', requireJobAccess(), asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });

  await db.schemaReady;
  await db.query('DELETE FROM notes WHERE id = $1 AND job_id = $2', [noteId, jobId]);
  res.json({ success: true });
}));

module.exports = router;
