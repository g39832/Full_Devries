const express = require('express');
const router = express.Router();
const db = require('./db');
const { asyncHandler, assertObject, parseIntField, parseNumberField, parseStringField, AppError } = require('./request-utils');
const { requireRole, getSessionUser } = require('./auth');

// All routes in this router are admin-only (enforced server-side).
router.use(requireRole('admin'));

// ======================================================
// FINANCE ADJUSTMENT (controlled override with full audit trail)
// ======================================================
router.post('/finance-adjustments', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.body.jobId, 'jobId', { min: 1 });
  const recordType = parseStringField(req.body.recordType ?? '', 'recordType', { minLength: 1, maxLength: 30 });
  const fieldName = parseStringField(req.body.field ?? '', 'field', { required: false, maxLength: 60, defaultValue: '' });
  const reason = parseStringField(req.body.reason ?? '', 'reason', { minLength: 3, maxLength: 2000 });
  const recordIdInput = req.body.recordId;
  const oldValue = parseNumberField(req.body.oldValue ?? 0, 'oldValue', { required: false, defaultValue: 0 });
  const newValue = parseNumberField(req.body.newValue ?? 0, 'newValue', { required: false, defaultValue: 0, min: 0 });

  const validTypes = new Set(['payment', 'expense', 'total_due', 'job_cost']);
  if (!validTypes.has(recordType)) {
    throw new AppError(400, `recordType must be one of: ${[...validTypes].join(', ')}`);
  }

  await db.schemaReady;
  const jobResult = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = jobResult.rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const actor = getSessionUser(req);
  const conn = await db.pool.connect();
  let adjustment = null;
  try {
    await conn.query('BEGIN');

    if (recordType === 'payment') {
      const recordId = parseIntField(recordIdInput, 'recordId', { min: 1 });
      const paymentResult = await conn.query('SELECT * FROM payments WHERE id = $1 AND job_id = $2', [recordId, jobId]);
      const payment = paymentResult.rows[0];
      if (!payment) throw new AppError(404, 'Payment not found for this job');
      const delta = newValue - Number(payment.amount || 0);
      if (delta !== 0) {
        await conn.query(
          'INSERT INTO payments (client_id, job_id, amount, payment_date) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
          [job.client_id, jobId, delta]
        );
      }
      adjustment = {
        client_id: job.client_id,
        job_id: jobId,
        record_type: recordType,
        record_id: recordId,
        field_name: fieldName || 'payment.amount',
        old_value: Number(payment.amount || 0),
        new_value: newValue,
        reason,
        adjusted_by: actor.email,
        adjusted_by_name: actor.name
      };
    } else if (recordType === 'expense') {
      const recordId = parseIntField(recordIdInput, 'recordId', { min: 1 });
      const expenseResult = await conn.query('SELECT * FROM finance_margin_entries WHERE id = $1 AND job_id = $2', [recordId, jobId]);
      const expense = expenseResult.rows[0];
      if (!expense) throw new AppError(404, 'Expense not found for this job');
      const oldAmount = Number(expense.amount || 0);
      await conn.query('UPDATE finance_margin_entries SET amount = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newValue, recordId]);
      adjustment = {
        client_id: job.client_id,
        job_id: jobId,
        record_type: recordType,
        record_id: recordId,
        field_name: fieldName || 'expense.amount',
        old_value: oldAmount,
        new_value: newValue,
        reason,
        adjusted_by: actor.email,
        adjusted_by_name: actor.name
      };
    } else if (recordType === 'total_due') {
      const oldAmount = Number(job.total_due || 0);
      const newBalance = Math.max(0, newValue - Number(job.amount_paid || 0));
      await conn.query('UPDATE jobs SET total_due = $1, balance = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newValue, newBalance, jobId]);
      adjustment = {
        client_id: job.client_id,
        job_id: jobId,
        record_type: recordType,
        record_id: null,
        field_name: fieldName || 'job.total_due',
        old_value: oldAmount,
        new_value: newValue,
        reason,
        adjusted_by: actor.email,
        adjusted_by_name: actor.name
      };
    } else if (recordType === 'job_cost') {
      const oldAmount = Number(job.job_cost || 0);
      await conn.query('UPDATE jobs SET job_cost = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newValue, jobId]);
      adjustment = {
        client_id: job.client_id,
        job_id: jobId,
        record_type: recordType,
        record_id: null,
        field_name: fieldName || 'job.job_cost',
        old_value: oldAmount,
        new_value: newValue,
        reason,
        adjusted_by: actor.email,
        adjusted_by_name: actor.name
      };
    }

    const inserted = await conn.query(`
      INSERT INTO finance_adjustments (
        client_id, job_id, record_type, record_id, field_name, old_value, new_value, reason, adjusted_by, adjusted_by_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      adjustment.client_id, adjustment.job_id, adjustment.record_type, adjustment.record_id,
      adjustment.field_name, adjustment.old_value, adjustment.new_value, adjustment.reason,
      adjustment.adjusted_by, adjustment.adjusted_by_name
    ]);
    adjustment = inserted.rows[0];

    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  return res.json({ success: true, adjustment });
}));

// ======================================================
// LIST ADJUSTMENT AUDIT TRAIL (filter by job or client)
// ======================================================
router.get('/finance-adjustments', asyncHandler(async (req, res) => {
  const jobId = req.query.jobId ? parseIntField(req.query.jobId, 'jobId', { min: 1 }) : null;
  const clientId = req.query.clientId ? parseIntField(req.query.clientId, 'clientId', { min: 1 }) : null;

  await db.schemaReady;
  let sql = `
    SELECT a.*, j.name AS job_name, c.name AS client_name
    FROM finance_adjustments a
    LEFT JOIN jobs j ON j.id = a.job_id
    LEFT JOIN clients c ON c.id = a.client_id
    WHERE 1 = 1
  `;
  const params = [];
  if (jobId !== null) {
    params.push(jobId);
    sql += ` AND a.job_id = $${params.length}`;
  }
  if (clientId !== null) {
    params.push(clientId);
    sql += ` AND a.client_id = $${params.length}`;
  }
  sql += ' ORDER BY a.created_at DESC LIMIT 200';

  const { rows } = await db.query(sql, params);
  return res.json({ success: true, adjustments: rows });
}));

// ======================================================
// USER MANAGEMENT (admin)
// ======================================================
router.get('/users', asyncHandler(async (req, res) => {
  await db.schemaReady;
  const { rows } = await db.query(`
    SELECT id, email, name, role, is_active, created_at, last_login_at
    FROM app_users
    ORDER BY created_at ASC
  `);
  return res.json({ success: true, users: rows });
}));

router.put('/users/:id/role', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const role = parseStringField(req.body.role ?? '', 'role', { minLength: 1, maxLength: 20 });
  if (!['admin', 'user'].includes(role)) {
    throw new AppError(400, 'Role must be "admin" or "user"');
  }

  const actor = getSessionUser(req);
  if (Number(id) === Number(actor.id)) {
    throw new AppError(400, 'You cannot change your own role');
  }

  await db.schemaReady;
  const { rows } = await db.query(
    'UPDATE app_users SET role = $1 WHERE id = $2 RETURNING id, email, role',
    [role, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  return res.json({ success: true, user: rows[0] });
}));

// ======================================================
// ACTIVITY LOG (who did what — admin only)
// ======================================================
router.get('/activity', asyncHandler(async (req, res) => {
  const limit = parseIntField(req.query.limit ?? '200', 'limit', { min: 1, max: 1000 });
  const userEmail = parseStringField(req.query.user ?? '', 'user', { required: false, maxLength: 256, defaultValue: '' });

  await db.schemaReady;
  let sql = `
    SELECT id, actor_email, actor_name, actor_role, action, method, path, summary, created_at
    FROM activity_log
  `;
  const params = [];
  if (userEmail) {
    params.push(userEmail.toLowerCase());
    sql += ` WHERE lower(actor_email) = $${params.length}`;
  }
  params.push(limit);
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;

  const { rows } = await db.query(sql, params);
  return res.json({ success: true, activity: rows });
}));

module.exports = router;
