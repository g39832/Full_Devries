const express = require('express');
const router = express.Router();
const db = require('./db');
const { asyncHandler, assertObject, parseIntField, parseNumberField, parseStringField } = require('./request-utils');
const { createNotification } = require('../services/notifications');
const { getSessionUser } = require('./auth');
const { isAdminUser, requireAdmin, requireJobAccess, requireClientAccess } = require('./authz');

// ======================================================
// STATUS / APPROVAL CONFIG
// ======================================================
const FINANCE_ENABLED_STATUSES = new Set(['Approved', 'Completed', 'Invoice', 'Closed']);
const PENDING_STATUSES = new Set(['Prospect', 'Pending Approval', 'Lead']);

function isFinanceEnabled(status) {
  return FINANCE_ENABLED_STATUSES.has(String(status || '').trim());
}

function getValidYear(inputYear) {
  const currentYear = new Date().getFullYear();
  const parsed = Number.parseInt(inputYear, 10);
  return !parsed || parsed < 2000 || parsed > currentYear + 5 ? currentYear : parsed;
}

async function refreshFinanceTotals(year) {
  try {
    // Legacy finance_overrides cache — keep in sync so the finance page's
    // year totals reflect job-level data (payments land in the payment year).
    const paymentYear = getValidYear(year);
    const totalsResult = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM jobs WHERE EXTRACT(YEAR FROM created_at)::int = $1) AS total_clients,
        (SELECT COALESCE(SUM(total_due),0) FROM jobs WHERE EXTRACT(YEAR FROM created_at)::int = $1) AS total_expected,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE EXTRACT(YEAR FROM payment_date)::int = $1) AS total_received
    `, [paymentYear]);
    const totals = totalsResult.rows[0] || {};
    const expected = Number(totals.total_expected || 0);
    const received = Number(totals.total_received || 0);
    await db.query(`
      INSERT INTO finance_overrides (year, total_expected, total_received, total_remaining, total_clients)
      VALUES ($1, $2::double precision, $3::double precision, GREATEST(0, $2::double precision - $3::double precision), $4)
      ON CONFLICT (year) DO UPDATE SET
        total_expected = EXCLUDED.total_expected,
        total_received = EXCLUDED.total_received,
        total_remaining = GREATEST(0, EXCLUDED.total_expected - EXCLUDED.total_received),
        total_clients = EXCLUDED.total_clients,
        updated_at = CURRENT_TIMESTAMP
    `, [paymentYear, expected, received, Number(totals.total_clients || 0)]);
  } catch (err) {
    console.error('refreshFinanceTotals failed:', err.message);
  }
}

// ======================================================
// FINANCE COMPUTATION (authoritative — derived from transactions)
// ======================================================
async function getJobFinance(jobId, jobRow = null, includeCosts = false) {
  const job = jobRow || (await db.query('SELECT * FROM jobs WHERE id = $1', [jobId])).rows[0];
  if (!job) return null;

  const paidResult = await db.query(
    'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE job_id = $1',
    [job.id]
  );
  const entryExpensesResult = await db.query(
    'SELECT COALESCE(SUM(amount), 0) AS expenses FROM finance_margin_entries WHERE job_id = $1',
    [job.id]
  );

  const totalDue = Number(job.total_due || 0);
  const paid = Number(paidResult.rows[0]?.paid || 0);
  const entryExpenses = Number(entryExpensesResult.rows[0]?.expenses || 0);
  const jobCost = Number(job.job_cost || 0);
  const expenses = entryExpenses + jobCost;

  const balanceDue = Math.max(0, totalDue - paid);
  const overpayment = Math.max(0, paid - totalDue);
  const profit = paid - expenses;
  const marginPct = paid > 0 ? (profit / paid) * 100 : null;

  // Cost / margin data is admin-only. Restricted users still receive the
  // revenue side (due / paid / balance / credit) they need for sales work.
  return {
    total_due: totalDue,
    paid,
    balance_due: balanceDue,
    overpayment,
    job_cost: includeCosts ? jobCost : null,
    entry_expenses: includeCosts ? entryExpenses : null,
    expenses: includeCosts ? expenses : null,
    profit: includeCosts ? profit : null,
    margin_pct: includeCosts ? (marginPct !== null ? Math.round(marginPct * 10) / 10 : null) : null,
    finance_enabled: isFinanceEnabled(job.status)
  };
}

async function getJobTags(jobId) {
  const { rows } = await db.query(`
    SELECT t.id, t.name
    FROM tags t
    JOIN job_tags jt ON jt.tag_id = t.id
    WHERE jt.job_id = $1
    ORDER BY t.name ASC
  `, [jobId]);
  return rows;
}

async function hydrateJob(row, includeCosts = false) {
  if (!row) return null;
  const [finance, tags] = await Promise.all([getJobFinance(row.id, row, includeCosts), getJobTags(row.id)]);
  return { ...row, finance, tags };
}

async function getClientName(clientId) {
  const { rows } = await db.query('SELECT name FROM clients WHERE id = $1', [clientId]);
  return rows[0]?.name || '';
}

// ======================================================
// LIST JOBS FOR A CLIENT
// ======================================================
router.get('/clients/:clientId/jobs', requireClientAccess(), asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const user = getSessionUser(req);
  await db.schemaReady;
  const params = [clientId];
  let sql = `
    SELECT j.*, u.name AS sales_person_name, u.email AS sales_person_email,
           (SELECT COUNT(*)::int FROM notes n WHERE n.job_id = j.id) AS note_count
    FROM jobs j
    LEFT JOIN app_users u ON u.id = j.sales_user_id
    WHERE j.client_id = $1
  `;
  sql += ` ORDER BY j.created_at ASC, j.id ASC`;
  const { rows } = await db.query(sql, params);
  const hydrated = await Promise.all(rows.map((row) => hydrateJob(row, isAdminUser(user))));
  return res.json({ success: true, jobs: hydrated });
}));

// ======================================================
// ADD JOB TO CLIENT (never creates a duplicate client)
// ======================================================
router.post('/clients/:clientId/jobs', requireClientAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const user = getSessionUser(req);
  const name = parseStringField(req.body.name ?? '', 'name', { minLength: 1, maxLength: 260 });
  const status = parseStringField(req.body.status ?? 'Pending Approval', 'status', { required: false, maxLength: 30, defaultValue: 'Pending Approval' });
  const address = parseStringField(req.body.address ?? '', 'address', { required: false, maxLength: 500, defaultValue: '' });
  const scope = parseStringField(req.body.scope_of_work ?? '', 'scope_of_work', { required: false, maxLength: 5000, defaultValue: '' });
  // Total due and job cost are financial records — admin-only. Restricted
  // users always get 0 (admins fill in amounts later).
  const totalDue = isAdminUser(user)
    ? parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0, min: 0 })
    : 0;
  const jobCost = isAdminUser(user)
    ? parseNumberField(req.body.job_cost ?? 0, 'job_cost', { required: false, defaultValue: 0, min: 0 })
    : 0;
  // Admins may assign a sales person; restricted users are always their own.
  const salesUserId = isAdminUser(user)
    ? (req.body.sales_user_id != null ? parseIntField(req.body.sales_user_id, 'sales_user_id', { min: 1, required: false }) : null)
    : Number(user.id);
  const lineItems = Array.isArray(req.body.line_items) ? req.body.line_items.slice(0, 200) : [];

  await db.schemaReady;
  const clientResult = await db.query('SELECT name FROM clients WHERE id = $1', [clientId]);
  if (!clientResult.rows[0]) return res.status(404).json({ error: 'Client not found' });

  const conn = await db.pool.connect();
  let job;
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(`
      INSERT INTO jobs (client_id, name, status, address, scope_of_work, job_cost, total_due, amount_paid, balance, sales_user_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `, [clientId, name, status, address, scope, jobCost, totalDue, salesUserId]);
    job = rows[0];
    for (const [idx, li] of lineItems.entries()) {
      const description = String(li.description || '').slice(0, 500);
      const quantity = Number(li.quantity);
      const unitPrice = Number(li.unit_price);
      const amount = Number(li.amount);
      if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || !Number.isFinite(amount)) continue;
      if (!description && amount === 0) continue;
      await conn.query(
        'INSERT INTO job_line_items (job_id, description, quantity, unit_price, amount, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
        [job.id, description, quantity, unitPrice, amount, idx]
      );
    }
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const clientName = clientResult.rows[0].name;
  await createNotification({
    type: 'job_added',
    message: `New job "${name}" added for ${clientName}.`,
    entityType: 'job',
    entityId: job.id,
    clientId,
    jobId: job.id
  });
  if (PENDING_STATUSES.has(status)) {
    await createNotification({
      type: 'awaiting_approval',
      message: `"${name}" (${clientName}) is awaiting approval.`,
      entityType: 'job',
      entityId: job.id,
      clientId,
      jobId: job.id
    });
  }

  return res.json({ success: true, job: await hydrateJob(job, isAdminUser(user)) });
}));

// ======================================================
// JOB DETAIL
// ======================================================
router.get('/jobs/:id', requireJobAccess(), asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(`
    SELECT j.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email, c.address AS client_address,
           c.primary_tag_id, u.name AS sales_person_name, u.email AS sales_person_email
    FROM jobs j
    JOIN clients c ON c.id = j.client_id
    LEFT JOIN app_users u ON u.id = j.sales_user_id
    WHERE j.id = $1
  `, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  const includeCosts = isAdminUser(getSessionUser(req));
  const job = await hydrateJob(rows[0], includeCosts);
  job.line_items = (await db.query(
    'SELECT id, description, quantity, unit_price, amount, sort_order FROM job_line_items WHERE job_id = $1 ORDER BY sort_order ASC, id ASC',
    [id]
  )).rows;
  const clientFinance = await getClientFinance(rows[0].client_id, includeCosts);
  return res.json({ success: true, job, client_finance: clientFinance });
}));

// ======================================================
// UPDATE JOB (idempotent approval → no duplicate finance records)
// ======================================================
router.put('/jobs/:id', requireJobAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const user = getSessionUser(req);
  const name = parseStringField(req.body.name ?? '', 'name', { required: false, maxLength: 260 });
  const status = parseStringField(req.body.status ?? '', 'status', { required: false, maxLength: 30 });
  const address = parseStringField(req.body.address ?? '', 'address', { required: false, maxLength: 500 });
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? '', 'scope_of_work', { required: false, maxLength: 5000 });
  const jobCostInput = req.body.job_cost;
  const totalDueInput = req.body.total_due;

  await db.schemaReady;
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const nextName = name || job.name;
  const nextStatus = status || job.status;
  const nextAddress = req.body.address !== undefined ? address : job.address;
  const nextScope = req.body.scope_of_work !== undefined ? scopeOfWork : job.scope_of_work;
  // Job cost is admin-only; restricted users can never change it (even if they
  // send a stale value captured from their own view).
  const nextJobCost = isAdminUser(user) && typeof jobCostInput !== 'undefined'
    ? parseNumberField(jobCostInput, 'job_cost', { required: false, min: 0, defaultValue: Number(job.job_cost || 0) })
    : Number(job.job_cost || 0);
  // Total due is a financial record — admin-only; restricted users can never
  // change it (even if they send a stale value captured from their own view).
  const nextTotalDue = isAdminUser(user) && typeof totalDueInput !== 'undefined'
    ? parseNumberField(totalDueInput, 'total_due', { required: false, min: 0, defaultValue: Number(job.total_due || 0) })
    : Number(job.total_due || 0);
  const nextBalance = Math.max(0, nextTotalDue - Number(job.amount_paid || 0));

  // Only admins may (re)assign a sales person.
  let nextSalesUserId = job.sales_user_id;
  if (isAdminUser(user) && req.body.sales_user_id !== undefined) {
    nextSalesUserId = req.body.sales_user_id === null || req.body.sales_user_id === ''
      ? null
      : parseIntField(req.body.sales_user_id, 'sales_user_id', { min: 1, required: false });
  }

  await db.query(`
    UPDATE jobs
    SET name = $1, status = $2, address = $3, scope_of_work = $4, job_cost = $5, total_due = $6, balance = $7, sales_user_id = $8, updated_at = CURRENT_TIMESTAMP
    WHERE id = $9
  `, [nextName, nextStatus, nextAddress, nextScope, nextJobCost, nextTotalDue, nextBalance, nextSalesUserId, id]);

  const updated = (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
  const clientName = await getClientName(updated.client_id);

  // Approval notification — idempotent: only fires on a real transition.
  const wasApproved = isFinanceEnabled(job.status);
  const nowApproved = isFinanceEnabled(nextStatus);
  if (!wasApproved && nowApproved) {
    await createNotification({
      type: 'approved',
      message: `"${updated.name}" (${clientName}) approved. Finance tracking enabled.`,
      entityType: 'job',
      entityId: updated.id,
      clientId: updated.client_id,
      jobId: updated.id
    });
  } else if (wasApproved && !nowApproved) {
    await createNotification({
      type: 'finance_disabled',
      message: `"${updated.name}" (${clientName}) was moved out of approved status. Finance tracking is now locked.`,
      entityType: 'job',
      entityId: updated.id,
      clientId: updated.client_id,
      jobId: updated.id
    });
  }

  return res.json({ success: true, job: await hydrateJob(updated, isAdminUser(getSessionUser(req))) });
}));

// ======================================================
// DELETE JOB (preserves financial history — re-points records)
// ======================================================
router.delete('/jobs/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const remaining = await db.query(
    'SELECT id FROM jobs WHERE client_id = $1 AND id <> $2 ORDER BY created_at ASC, id ASC LIMIT 1',
    [job.client_id, id]
  );

  if (!remaining.rows[0]) {
    return res.status(400).json({ error: 'Cannot delete the only job for this client. Delete the client instead.' });
  }

  const targetJobId = remaining.rows[0].id;
  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query('UPDATE payments SET job_id = $1 WHERE job_id = $2', [targetJobId, id]);
    await conn.query('UPDATE notes SET job_id = $1 WHERE job_id = $2', [targetJobId, id]);
    await conn.query('UPDATE finance_margin_entries SET job_id = $1 WHERE job_id = $2', [targetJobId, id]);
    await conn.query('DELETE FROM jobs WHERE id = $1', [id]);
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  return res.json({ success: true, movedToJobId: targetJobId });
}));

// ======================================================
// JOB FINANCE — TOTAL DUE
// ======================================================
router.put('/jobs/:id/total', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const total = parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0, min: 0 });

  await db.schemaReady;
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  const paid = Number(rows[0].amount_paid || 0);
  const balance = Math.max(0, total - paid);
  await db.query('UPDATE jobs SET total_due = $1, balance = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [total, balance, id]);

  const updated = (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
  return res.json({ success: true, job: await hydrateJob(updated, isAdminUser(getSessionUser(req))) });
}));

// ======================================================
// JOB FINANCE — RECORD PAYMENT (APPROVED ONLY, server-enforced)
// ======================================================
router.put('/jobs/:id/payment', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const amount = parseNumberField(req.body.payment ?? 0, 'payment', { required: false, defaultValue: 0 });
  if (amount <= 0) return res.status(400).json({ error: 'Invalid payment amount' });

  await db.schemaReady;
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!isFinanceEnabled(job.status)) {
    return res.status(400).json({
      error: 'Finance tracking is locked until this job is APPROVED. Set the job status to Approved first.'
    });
  }

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query(
      'INSERT INTO payments (client_id, job_id, amount, payment_date) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
      [job.client_id, id, amount]
    );
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const clientName = await getClientName(job.client_id);
  const finance = await getJobFinance(id, undefined, isAdminUser(getSessionUser(req)));
  await createNotification({
    type: 'payment',
    message: `Payment of $${Number(amount).toFixed(2)} received for ${clientName} ("${job.name}").`,
    entityType: 'job',
    entityId: id,
    clientId: job.client_id,
    jobId: id
  });
  if (finance.overpayment > 0) {
    await createNotification({
      type: 'overpayment',
      message: `Overpayment of $${finance.overpayment.toFixed(2)} on ${clientName} ("${job.name}") — recorded as a credit, not a negative balance.`,
      entityType: 'job',
      entityId: id,
      clientId: job.client_id,
      jobId: id
    });
  }

  await refreshFinanceTotals(new Date().getFullYear());
  return res.json({ success: true, job: await hydrateJob(job, isAdminUser(getSessionUser(req))), finance });
}));

// ======================================================
// JOB FINANCE — RESET PAID (force re-calc, admin-adjacent tool)
// ======================================================
router.put('/jobs/:id/reset-paid', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const alreadyPaid = Number(job.amount_paid || 0);
  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    if (alreadyPaid > 0) {
      await conn.query(
        'INSERT INTO payments (client_id, job_id, amount, payment_date) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [job.client_id, id, -alreadyPaid]
      );
    }
    const newBalance = Math.max(0, Number(job.total_due || 0));
    await conn.query('UPDATE jobs SET amount_paid = 0, balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newBalance, id]);
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const updated = (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
  return res.json({ success: true, job: await hydrateJob(updated, isAdminUser(getSessionUser(req))) });
}));

// ======================================================
// JOB FINANCE — RESTORE STATE (for undo; delta row, like legacy behavior)
// ======================================================
router.put('/jobs/:id/finance-state', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const totalDue = parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0, min: 0 });
  const amountPaid = parseNumberField(req.body.amount_paid ?? 0, 'amount_paid', { required: false, defaultValue: 0, min: 0 });

  await db.schemaReady;
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const deltaPaid = amountPaid - Number(job.amount_paid || 0);
  const nextBalance = Math.max(0, totalDue - amountPaid);

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    if (deltaPaid !== 0) {
      await conn.query(
        'INSERT INTO payments (client_id, job_id, amount, payment_date) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [job.client_id, id, deltaPaid]
      );
    }
    await conn.query(
      'UPDATE jobs SET total_due = $1, amount_paid = $2, balance = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [totalDue, amountPaid, nextBalance, id]
    );
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const updated = (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
  return res.json({ success: true, job: await hydrateJob(updated, isAdminUser(getSessionUser(req))) });
}));

// ======================================================
// JOB PAYMENTS (transaction history)
// ======================================================
router.get('/jobs/:id/payments', requireJobAccess(), asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(`
    SELECT id, client_id, job_id, amount, payment_date
    FROM payments WHERE job_id = $1 ORDER BY payment_date DESC, id DESC
  `, [id]);
  return res.json({ success: true, payments: rows });
}));

// ======================================================
// JOB EXPENSES
// ======================================================
async function insertExpense(job, body) {
  const category = parseStringField(body.category ?? 'Misc', 'category', { required: false, maxLength: 80, defaultValue: 'Misc' });
  const project = parseStringField(body.project ?? '', 'project', { required: false, maxLength: 120, defaultValue: '' });
  const invoiceStatus = parseStringField(body.invoice_status ?? 'Pending', 'invoice_status', { required: false, maxLength: 80, defaultValue: 'Pending' });
  const amount = parseNumberField(body.amount ?? 0, 'amount', { required: false, defaultValue: 0, min: 0 });
  const expenseType = parseStringField(body.expense_type ?? 'one-time', 'expense_type', { required: false, maxLength: 40, defaultValue: 'one-time' });
  const notes = parseStringField(body.notes ?? '', 'notes', { required: false, maxLength: 5000, defaultValue: '' });

  const expenseDate = (() => {
    if (!body.expense_date) return new Date().toISOString();
    const date = new Date(body.expense_date);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  })();

  const clientName = job.client_name || await getClientName(job.client_id);
  const { rows } = await db.query(`
    INSERT INTO finance_margin_entries (
      client_id, job_id, client_name, category, project, invoice_status,
      amount, expense_type, recurring, expense_date, notes, attachment_url, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING *
  `, [job.client_id, job.id, clientName, category, project, invoiceStatus, amount, expenseType, expenseDate, notes]);

  return rows[0];
}

router.get('/jobs/:id/expenses', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(`
    SELECT * FROM finance_margin_entries WHERE job_id = $1 ORDER BY expense_date DESC, id DESC
  `, [id]);
  return res.json({ success: true, expenses: rows });
}));

router.post('/jobs/:id/expenses', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(`
    SELECT j.*, c.name AS client_name FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.id = $1
  `, [id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!isFinanceEnabled(job.status)) {
    return res.status(400).json({ error: 'Finance tracking is locked until this job is APPROVED. Set the job status to Approved first.' });
  }

  const expense = await insertExpense(job, req.body);
  await createNotification({
    type: 'expense',
    message: `Expense of $${Number(expense.amount || 0).toFixed(2)} recorded for ${job.client_name} ("${job.name}").`,
    entityType: 'job',
    entityId: id,
    clientId: job.client_id,
    jobId: id
  });

  return res.json({ success: true, expense });
}));

router.delete('/jobs/:id/expenses/:expenseId', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const expenseId = parseIntField(req.params.expenseId, 'expenseId', { min: 1 });
  await db.schemaReady;
  await db.query('DELETE FROM finance_margin_entries WHERE id = $1 AND job_id = $2', [expenseId, id]);
  return res.json({ success: true });
}));

// ======================================================
// JOB TAGS (attach/remove — any authenticated user)
// ======================================================
router.put('/jobs/:id/tags', requireJobAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const tagIds = Array.isArray(req.body.tagIds)
    ? [...new Set(req.body.tagIds.map((t) => parseIntField(t, 'tagId', { min: 1 })))]
    : [];

  await db.schemaReady;
  const { rows } = await db.query('SELECT id FROM jobs WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

  if (tagIds.length > 0) {
    const valid = await db.query('SELECT id FROM tags WHERE id = ANY($1)', [tagIds]);
    const validIds = valid.rows.map((r) => Number(r.id));
    if (validIds.length !== tagIds.length) {
      return res.status(400).json({ error: 'One or more tags do not exist' });
    }
  }

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query('DELETE FROM job_tags WHERE job_id = $1', [id]);
    for (const tagId of tagIds) {
      await conn.query(
        'INSERT INTO job_tags (job_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, tagId]
      );
    }
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  return res.json({ success: true, tags: await getJobTags(id) });
}));

// ======================================================
// JOB LINE ITEMS (estimate/invoice breakdown)
// ======================================================
router.get('/jobs/:id/line-items', requireJobAccess(), asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(
    'SELECT id, description, quantity, unit_price, amount, sort_order FROM job_line_items WHERE job_id = $1 ORDER BY sort_order ASC, id ASC',
    [id]
  );
  return res.json({ success: true, items: rows });
}));

router.put('/jobs/:id/line-items', requireJobAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 200) : [];

  await db.schemaReady;
  const jobResult = await db.query('SELECT id, amount_paid FROM jobs WHERE id = $1', [id]);
  if (!jobResult.rows[0]) return res.status(404).json({ error: 'Job not found' });

  const conn = await db.pool.connect();
  let total = 0;
  try {
    await conn.query('BEGIN');
    await conn.query('DELETE FROM job_line_items WHERE job_id = $1', [id]);
    for (const [idx, li] of items.entries()) {
      const description = String(li.description || '').slice(0, 500);
      const quantity = Number(li.quantity);
      const unitPrice = Number(li.unit_price);
      const amount = Number(li.amount);
      if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || !Number.isFinite(amount)) continue;
      if (!description && amount === 0) continue;
      const safeAmount = Math.max(0, amount);
      total += safeAmount;
      await conn.query(
        'INSERT INTO job_line_items (job_id, description, quantity, unit_price, amount, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, description, quantity, unitPrice, safeAmount, idx]
      );
    }
    // Line items are the pricing source: keep the finance "amount due" in sync.
    if (items.length > 0) {
      await conn.query(
        'UPDATE jobs SET total_due = $1, balance = GREATEST(0, $1 - amount_paid), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [total, id]
      );
    }
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const { rows } = await db.query(
    'SELECT id, description, quantity, unit_price, amount, sort_order FROM job_line_items WHERE job_id = $1 ORDER BY sort_order ASC, id ASC',
    [id]
  );
  return res.json({ success: true, items: rows, total });
}));

// ======================================================
// JOB PHOTOS (list — storage-backed, includes legacy client key)
// ======================================================
router.get('/jobs/:id/photos', requireJobAccess(), asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query('SELECT id, client_id, legacy_storage_key FROM jobs WHERE id = $1', [id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { remoteListFiles } = require('../services/storage');
  const keys = [`job-${id}`];
  if (job.legacy_storage_key) keys.push(String(job.legacy_storage_key));

  const files = [];
  const seen = new Set();
  for (const key of keys) {
    try {
      const listed = await remoteListFiles(key);
      for (const file of listed) {
        if (seen.has(file.name)) continue;
        seen.add(file.name);
        files.push({ ...file, storageKey: key });
      }
    } catch (err) {
      console.error(`List storage key ${key} failed:`, err.message);
    }
  }

  return res.json({ success: true, files });
}));

// ======================================================
// SEARCH JOBS BY TAG (clicking a tag filters all jobs)
// ======================================================
router.get('/jobs', asyncHandler(async (req, res) => {
  const tagIdRaw = req.query.tag_id;
  const tagId = tagIdRaw ? parseIntField(tagIdRaw, 'tag_id', { min: 1 }) : null;
  const salesUserIdRaw = req.query.sales_user_id;
  const salesUserId = salesUserIdRaw ? parseIntField(salesUserIdRaw, 'sales_user_id', { min: 1 }) : null;
  const primaryTagRaw = req.query.primary_tag_id;
  const primaryTagId = primaryTagRaw ? parseIntField(primaryTagRaw, 'primary_tag_id', { min: 1 }) : null;
  const status = req.query.status ? parseStringField(req.query.status, 'status', { required: false, maxLength: 30 }) : null;
  const user = getSessionUser(req);

  await db.schemaReady;
  const params = [];
  let where = '';
  if (tagId !== null) {
    params.push(tagId);
    where += ` AND jt.tag_id = $${params.length}`;
  }
  if (salesUserId !== null) {
    params.push(salesUserId);
    where += ` AND j.sales_user_id = $${params.length}`;
  }
  if (primaryTagId !== null) {
    params.push(primaryTagId);
    where += ` AND c.primary_tag_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    where += ` AND j.status = $${params.length}`;
  }

  const tagJoin = tagId !== null ? ` JOIN job_tags jt ON jt.job_id = j.id` : '';
  const { rows } = await db.query(`
    SELECT j.*, c.name AS client_name, u.name AS sales_person_name,
           (SELECT COUNT(*)::int FROM notes n WHERE n.job_id = j.id) AS note_count
    FROM jobs j
    JOIN clients c ON c.id = j.client_id
    LEFT JOIN app_users u ON u.id = j.sales_user_id
    ${tagJoin}
    WHERE 1=1 ${where}
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT 500
  `, params);

  const hydrated = await Promise.all(rows.map(async (row) => {
    const finance = await getJobFinance(row.id, row, isAdminUser(user));
    const tags = await getJobTags(row.id);
    return { ...row, finance, tags };
  }));

  return res.json({ success: true, jobs: hydrated });
}));

// ======================================================
// CLIENT-LEVEL AGGREGATE (sum across all of a client's jobs)
// ======================================================
async function getClientFinance(clientId, includeCosts = false) {
  const { rows } = await db.query('SELECT * FROM jobs WHERE client_id = $1', [clientId]);
  const jobs = rows || [];
  let totalDue = 0;
  let paid = 0;
  let balanceDue = 0;
  let overpayment = 0;
  let expenses = 0;
  let jobCount = 0;
  let approvedCount = 0;

  for (const job of jobs) {
    const finance = await getJobFinance(job.id, job, includeCosts);
    totalDue += finance.total_due;
    paid += finance.paid;
    balanceDue += finance.balance_due;
    overpayment += finance.overpayment;
    if (includeCosts) expenses += Number(finance.expenses || 0);
    jobCount += 1;
    if (finance.finance_enabled) approvedCount += 1;
  }

  const profit = paid - expenses;
  return {
    total_due: totalDue,
    paid,
    balance_due: balanceDue,
    overpayment,
    expenses: includeCosts ? expenses : null,
    profit: includeCosts ? profit : null,
    margin_pct: includeCosts ? (paid > 0 ? Math.round((profit / paid) * 1000) / 10 : null) : null,
    job_count: jobCount,
    approved_job_count: approvedCount
  };
}

module.exports = { router, isFinanceEnabled, getJobFinance, getJobTags, getClientFinance, hydrateJob };
