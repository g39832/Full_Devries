const express = require('express');
const router = express.Router();
const db = require('./db');
const { asyncHandler, assertObject, parseIntField, parseNumberField, parseStringField, parseYear } = require('./request-utils');
const { isFinanceEnabled } = require('./jobs');
const { getSessionUser } = require('./auth');
const { isAdminUser, requireAdmin, requireClientAccess } = require('./authz');

// ======================================================
// HELPER: SAFE YEAR HANDLER
// ======================================================
function getValidYear(inputYear) {
  const currentYear = new Date().getFullYear();
  const parsed = Number.parseInt(inputYear, 10);
  return !parsed || parsed < 2000 || parsed > currentYear + 5
    ? currentYear
    : parsed;
}

function parseOptionalPagination(value, max) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(parsed, max);
}

async function getFinanceTotalsForYear(year) {
  // Authoritative source is job-level data — client aggregates are computed
  // from `jobs`, never from stale client cache columns.
  const clientSummaryResult = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM jobs WHERE EXTRACT(YEAR FROM created_at)::int = $1) AS total_clients,
      (SELECT COALESCE(SUM(total_due), 0) FROM jobs WHERE EXTRACT(YEAR FROM created_at)::int = $1) AS total_expected,
      (SELECT COALESCE(SUM(GREATEST(0, total_due - amount_paid)), 0) FROM jobs WHERE EXTRACT(YEAR FROM created_at)::int = $1) AS total_remaining
  `, [year]);

  const paymentSummaryResult = await db.query(`
    SELECT COALESCE(SUM(amount), 0) AS total_received
    FROM payments
    WHERE EXTRACT(YEAR FROM payment_date)::int = $1
  `, [year]);

  const clientSummary = clientSummaryResult.rows[0] || {};
  const paymentSummary = paymentSummaryResult.rows[0] || {};

  return {
    total_clients: Number(clientSummary.total_clients || 0),
    total_expected: Number(clientSummary.total_expected || 0),
    total_received: Number(paymentSummary.total_received || 0),
    total_remaining: Number(clientSummary.total_remaining || 0)
  };
}

// ======================================================
// HELPER: UPDATE FINANCE TOTALS FOR A YEAR
// ======================================================
async function updateFinanceTotals(year) {
  year = getValidYear(year);
  const totals = await getFinanceTotalsForYear(year);

  await db.query(`
    INSERT INTO finance_overrides (year, total_expected, total_received, total_remaining, total_clients)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(year) DO UPDATE SET
      total_expected = EXCLUDED.total_expected,
      total_received = EXCLUDED.total_received,
      total_remaining = EXCLUDED.total_remaining,
      total_clients = EXCLUDED.total_clients,
      updated_at = CURRENT_TIMESTAMP
  `, [
    year,
    totals.total_expected,
    totals.total_received,
    totals.total_remaining,
    totals.total_clients
  ]);
}

// ======================================================
// SEARCH CLIENTS
// ======================================================
router.get('/search', asyncHandler(async (req, res) => {
  const term = parseStringField(req.query.q ?? '', 'q', { required: false, maxLength: 200, defaultValue: '' });
  const limit = parseOptionalPagination(req.query.limit, 500);
  const offset = parseOptionalPagination(req.query.offset, 1000000) ?? 0;
  const primaryTagRaw = req.query.primary_tag_id;
  const primaryTagId = primaryTagRaw ? parseIntField(primaryTagRaw, 'primary_tag_id', { min: 1 }) : null;
  const user = getSessionUser(req);
  await db.schemaReady;

  const clientColumns = `
    clients.*,
    (SELECT COUNT(*)::int FROM jobs WHERE jobs.client_id = clients.id) AS job_count,
    pt.name AS primary_tag_name
  `;

  const params = [];
  let where = '';
  if (primaryTagId !== null) {
    params.push(primaryTagId);
    where += ` AND clients.primary_tag_id = $${params.length}`;
  }

  if (!term) {
    let sql = `SELECT ${clientColumns} FROM clients LEFT JOIN tags pt ON pt.id = clients.primary_tag_id WHERE 1=1 ${where} ORDER BY clients.created_at DESC`;
    const all = [...params];
    if (limit !== null) {
      all.push(limit, offset);
      sql += ` LIMIT $${all.length - 1} OFFSET $${all.length}`;
    }
    const { rows } = await db.query(sql, all);
    return res.json(rows);
  }

  const like = `%${term}%`;
  const all = [like, like, like, like, like];
  let sql = `
    SELECT DISTINCT ${clientColumns}
    FROM clients
    LEFT JOIN notes ON notes.client_id = clients.id
    LEFT JOIN tags pt ON pt.id = clients.primary_tag_id
    WHERE (clients.name ILIKE $1
       OR clients.phone ILIKE $2
       OR clients.email ILIKE $3
       OR clients.address ILIKE $4
       OR notes.content ILIKE $5)
  `;
  if (primaryTagId !== null) {
    all.push(primaryTagId);
    sql += ` AND clients.primary_tag_id = $${all.length}`;
  }
  sql += ' ORDER BY clients.created_at DESC';
  if (limit !== null) {
    all.push(limit, offset);
    sql += ` LIMIT $${all.length - 1} OFFSET $${all.length}`;
  }
  const { rows } = await db.query(sql, all);

  return res.json(rows);
}));

// ======================================================
// SAVE CLIENT
// ======================================================
router.post('/save-client', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const fName = parseStringField(req.body.fName ?? '', 'fName', { required: false, maxLength: 120, defaultValue: '' });
  const lName = parseStringField(req.body.lName ?? '', 'lName', { required: false, maxLength: 120, defaultValue: '' });
  const name = parseStringField(req.body.name ?? '', 'name', { required: false, maxLength: 260, defaultValue: '' });
  const phone = parseStringField(req.body.phone ?? '', 'phone', { required: false, maxLength: 40, defaultValue: '' });
  const email = parseStringField(req.body.email ?? '', 'email', { required: false, maxLength: 254, defaultValue: '' });
  const address = parseStringField(req.body.address ?? '', 'address', { required: false, maxLength: 500, defaultValue: '' });
  const status = parseStringField(req.body.status ?? 'Prospect', 'status', { required: false, maxLength: 30, defaultValue: 'Prospect' });
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? '', 'scope_of_work', { required: false, maxLength: 5000, defaultValue: '' });
  const finalName = name || `${fName} ${lName}`.trim();
  if (!finalName) return res.status(400).json({ error: 'Name required' });

  const user = getSessionUser(req);
  // Total due and job cost are financial records — admin-only. Restricted
  // users always get 0 (admins fill in amounts later).
  const total = isAdminUser(user)
    ? parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0 })
    : 0;
  const jobCost = isAdminUser(user)
    ? parseNumberField(req.body.job_cost ?? 0, 'job_cost', { required: false, defaultValue: 0 })
    : 0;
  const createdAt = new Date().toISOString();
  const salesUserId = isAdminUser(user)
    ? (req.body.sales_user_id != null ? parseIntField(req.body.sales_user_id, 'sales_user_id', { min: 1, required: false }) : null)
    : Number(user.id);

  await db.schemaReady;
  const conn = await db.pool.connect();
  let clientId = null;
  try {
    await conn.query('BEGIN');
    const clientResult = await conn.query(`
      INSERT INTO clients (name, phone, email, address, status, total_due, amount_paid, balance, scope_of_work, job_cost, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10)
      RETURNING id
    `, [finalName, phone, email, address, status || 'Prospect', total, total, scopeOfWork, jobCost, createdAt]);
    clientId = clientResult.rows[0].id;

    // Every new client starts with one default Job, so job-level data
    // (status, scope, cost, totals) lives on the Job while the Client row
    // stays the customer record. Adding more jobs never creates duplicates.
    const finalStatus = status || 'Prospect';
    await conn.query(`
      INSERT INTO jobs (client_id, name, status, address, scope_of_work, job_cost, total_due, amount_paid, balance, sales_user_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $7, $8, $9, $9)
    `, [clientId, finalName, finalStatus, address, scopeOfWork, jobCost, total, salesUserId, createdAt]);
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const year = new Date(createdAt).getFullYear();
  await updateFinanceTotals(year);

  // New leads are awaiting approval — keep it visible.
  try {
    const { createNotification } = require('../services/notifications');
    await createNotification({
      type: 'awaiting_approval',
      message: `${finalName} is a new client awaiting approval.`,
      entityType: 'client',
      entityId: clientId,
      clientId
    });
  } catch (err) {
    console.error('Client notification failed:', err.message);
  }

  return res.json({ success: true, financeUpdated: true, clientId });
}));

// ======================================================
// UPDATE CLIENT
// ======================================================
router.post('/update-project', requireClientAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.body.id, 'id', { min: 1 });
  const fName = parseStringField(req.body.fName ?? '', 'fName', { required: false, maxLength: 120, defaultValue: '' });
  const lName = parseStringField(req.body.lName ?? '', 'lName', { required: false, maxLength: 120, defaultValue: '' });
  const name = parseStringField(req.body.name ?? '', 'name', { required: false, maxLength: 260, defaultValue: '' });
  const phone = parseStringField(req.body.phone ?? '', 'phone', { required: false, maxLength: 40, defaultValue: '' });
  const email = parseStringField(req.body.email ?? '', 'email', { required: false, maxLength: 254, defaultValue: '' });
  const address = parseStringField(req.body.address ?? '', 'address', { required: false, maxLength: 500, defaultValue: '' });
  const status = parseStringField(req.body.status ?? '', 'status', { required: false, maxLength: 30, defaultValue: '' });
  const totalDueInput = req.body.total_due;
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? '', 'scope_of_work', { required: false, maxLength: 5000, defaultValue: '' });
  const jobCostInput = req.body.job_cost;
  const user = getSessionUser(req);

  await db.schemaReady;
  const clientResult = await db.query('SELECT name, phone, email, address, created_at, status FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];
  if (!clientRow) return res.status(404).json({ error: 'Client not found' });

  // Legacy endpoint: the client row holds contact info; job-level fields
  // (status/scope/cost/totals) map to the client's default (first) job.
  const jobResult = await db.query('SELECT id, status, address, scope_of_work, job_cost, total_due, amount_paid FROM jobs WHERE client_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1', [id]);
  const defaultJob = jobResult.rows[0];
  if (!defaultJob) return res.status(404).json({ error: 'Client has no jobs' });

  // Only update fields that were actually sent (never wipe unspecified ones).
  const finalName = name || `${fName} ${lName}`.trim() || clientRow.name;
  const nextPhone = req.body.phone !== undefined ? phone : clientRow.phone;
  const nextEmail = req.body.email !== undefined ? email : clientRow.email;
  const nextAddress = req.body.address !== undefined ? address : clientRow.address;
  const nextStatus = status || clientRow.status || 'Prospect';
  // Total due is a financial record — admin-only; restricted users can never change it.
  const nextTotal = isAdminUser(user) && typeof totalDueInput !== 'undefined'
    ? parseNumberField(totalDueInput, 'total_due', { required: false, defaultValue: Number(defaultJob.total_due || 0) })
    : Number(defaultJob.total_due || 0);
  // Job cost is admin-only; restricted users can never change it.
  const nextJobCost = isAdminUser(user) && typeof jobCostInput !== 'undefined'
    ? parseNumberField(jobCostInput, 'job_cost', { required: false, defaultValue: Number(defaultJob.job_cost || 0) })
    : Number(defaultJob.job_cost || 0);
  const nextScope = req.body.scope_of_work !== undefined ? scopeOfWork : defaultJob.scope_of_work;
  const nextBalance = Math.max(0, nextTotal - Number(defaultJob.amount_paid || 0));

  await db.query(`
    UPDATE clients
    SET name = $1, phone = $2, email = $3, address = $4, status = $5
    WHERE id = $6
  `, [finalName, nextPhone, nextEmail, nextAddress, nextStatus, id]);

  await db.query(`
    UPDATE jobs
    SET name = $1, status = $2, address = $3, scope_of_work = $4, job_cost = $5, total_due = $6, balance = $7, updated_at = CURRENT_TIMESTAMP
    WHERE id = $8
  `, [finalName, nextStatus, nextAddress, nextScope, nextJobCost, nextTotal, nextBalance, defaultJob.id]);

  // Idempotent approval notification on transition.
  try {
    const { isFinanceEnabled } = require('./jobs');
    const wasApproved = isFinanceEnabled(defaultJob.status);
    const nowApproved = isFinanceEnabled(nextStatus);
    if (!wasApproved && nowApproved) {
      const { createNotification } = require('../services/notifications');
      await createNotification({
        type: 'approved',
        message: `${finalName} approved. Finance tracking enabled.`,
        entityType: 'client',
        entityId: id,
        clientId: id
      });
    }
  } catch (err) {
    console.error('Approval notification failed:', err.message);
  }

  const year = new Date(clientRow.created_at || Date.now()).getFullYear();
  await updateFinanceTotals(year);

  return res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// PRIMARY TAG (client-level sorting tag — admin only)
// ======================================================
router.put('/clients/:id/primary-tag', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const primaryTagId = (req.body.primary_tag_id === null || req.body.primary_tag_id === '')
    ? null
    : parseIntField(req.body.primary_tag_id, 'primary_tag_id', { min: 1 });

  await db.schemaReady;
  if (primaryTagId !== null) {
    const tag = await db.query("SELECT id FROM tags WHERE id = $1 AND kind = 'client'", [primaryTagId]);
    if (!tag.rows[0]) return res.status(400).json({ error: 'Primary tag must be a client tag' });
  }
  const { rows } = await db.query(
    'UPDATE clients SET primary_tag_id = $1 WHERE id = $2 RETURNING id, primary_tag_id',
    [primaryTagId, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Client not found' });
  return res.json({ success: true, client: rows[0] });
}));

// ======================================================
// DELETE CLIENT
// ======================================================
router.post('/delete-client', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.body.id, 'id', { min: 1 });

  await db.schemaReady;
  const clientResult = await db.query('SELECT created_at FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];

  await db.query('DELETE FROM clients WHERE id = $1', [id]);

  if (clientRow) {
    const year = new Date(clientRow.created_at || Date.now()).getFullYear();
    await updateFinanceTotals(year);
  }

  return res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// UPDATE TOTAL DUE
// ======================================================
router.put('/clients/:id/total', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const total = parseNumberField(req.body.total_due, 'total_due', { required: false, defaultValue: 0 });

  await db.schemaReady;
  const clientResult = await db.query('SELECT amount_paid, created_at FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];
  if (!clientRow) return res.status(404).json({ error: 'Client not found' });

  // Legacy client-level total now updates the client's default job (the
  // authoritative job-level record); the client cache columns stay synced via
  // the database trigger, so old readers keep working.
  const jobResult = await db.query('SELECT id, amount_paid FROM jobs WHERE client_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1', [id]);
  const defaultJob = jobResult.rows[0];
  if (defaultJob) {
    const newBalance = Math.max(0, total - Number(defaultJob.amount_paid || 0));
    await db.query('UPDATE jobs SET total_due = $1, balance = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [total, newBalance, defaultJob.id]);
  }

  const year = new Date(clientRow.created_at || Date.now()).getFullYear();
  await updateFinanceTotals(year);

  return res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// RECORD PAYMENT
// ======================================================
router.put('/clients/:id/payment', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const amount = parseNumberField(req.body.payment ?? 0, 'payment', { required: false, defaultValue: 0 });
  if (amount <= 0) return res.status(400).json({ error: 'Invalid payment amount' });

  await db.schemaReady;
  const clientResult = await db.query('SELECT total_due, amount_paid, created_at FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];
  if (!clientRow) return res.status(404).json({ error: 'Client not found' });

  // Legacy client-level payment maps to the client's default job. Approved
  // status is enforced the same way as job-level payments.
  const jobResult = await db.query('SELECT id, status, total_due, amount_paid FROM jobs WHERE client_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1', [id]);
  const defaultJob = jobResult.rows[0];
  if (!defaultJob) return res.status(400).json({ error: 'Client has no jobs' });
  if (!isFinanceEnabled(defaultJob.status)) {
    return res.status(400).json({ error: 'Finance tracking is locked until this client/job is APPROVED. Set the status to Approved first.' });
  }

  const newPaid = Number(defaultJob.amount_paid || 0) + amount;
  const newBalance = Math.max(0, Number(defaultJob.total_due || 0) - newPaid);

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query(
      'INSERT INTO payments (client_id, job_id, amount, payment_date) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
      [id, defaultJob.id, amount]
    );
    await conn.query(
      'UPDATE jobs SET amount_paid = $1, balance = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [newPaid, newBalance, defaultJob.id]
    );
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  // The payment lands in the current year, but it also changes the
  // client's balance, which belongs to the client's creation year — so
  // refresh both years' cached totals.
  const paymentYear = new Date().getFullYear();
  const clientYear = new Date(clientRow.created_at || Date.now()).getFullYear();
  const yearsToUpdate = [...new Set([paymentYear, clientYear])];
  for (const y of yearsToUpdate) {
    await updateFinanceTotals(y);
  }

  return res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// RESET BALANCE (FORCE RE-CALC)
// ======================================================
router.put('/clients/:id/reset-paid', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });

  await db.schemaReady;
  const clientResult = await db.query('SELECT total_due, amount_paid, created_at FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];
  if (!clientRow) return res.status(404).json({ error: 'Client not found' });

  const jobResult = await db.query('SELECT id, total_due, amount_paid FROM jobs WHERE client_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1', [id]);
  const defaultJob = jobResult.rows[0];
  if (!defaultJob) return res.status(400).json({ error: 'Client has no jobs' });

  const alreadyPaid = Number(defaultJob.amount_paid || 0);

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    if (alreadyPaid > 0) {
      await conn.query(
        'INSERT INTO payments (client_id, job_id, amount, payment_date) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [id, defaultJob.id, -alreadyPaid]
      );
    }
    const newBalance = Math.max(0, Number(defaultJob.total_due || 0));
    await conn.query('UPDATE jobs SET amount_paid = 0, balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newBalance, defaultJob.id]);
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  // A negative payment row is inserted for the current year, and the
  // client's balance change belongs to its creation year — refresh both.
  const paymentYear = new Date().getFullYear();
  const clientYear = new Date(clientRow.created_at || Date.now()).getFullYear();
  const yearsToUpdate = [...new Set([paymentYear, clientYear])];
  for (const y of yearsToUpdate) {
    await updateFinanceTotals(y);
  }

  const updatedClientResult = await db.query('SELECT total_due, amount_paid, balance FROM clients WHERE id = $1', [id]);
  return res.json({ success: true, client: updatedClientResult.rows[0], financeUpdated: true });
}));

// ======================================================
// RESTORE FINANCE STATE (FOR UNDO)
// ======================================================
router.put('/clients/:id/finance-state', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const total_due = parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0 });
  const amount_paid = parseNumberField(req.body.amount_paid ?? 0, 'amount_paid', { required: false, defaultValue: 0 });

  await db.schemaReady;
  const clientResult = await db.query('SELECT total_due, amount_paid, created_at FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];
  if (!clientRow) return res.status(404).json({ error: 'Client not found' });

  const jobResult = await db.query('SELECT id, total_due, amount_paid FROM jobs WHERE client_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1', [id]);
  const defaultJob = jobResult.rows[0];
  if (!defaultJob) return res.status(400).json({ error: 'Client has no jobs' });

  const nextTotal = total_due;
  const nextPaid = amount_paid;
  const nextBalance = Math.max(0, nextTotal - nextPaid);
  const deltaPaid = nextPaid - Number(defaultJob.amount_paid || 0);

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    if (deltaPaid !== 0) {
      await conn.query(
        'INSERT INTO payments (client_id, job_id, amount, payment_date) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [id, defaultJob.id, deltaPaid]
      );
    }
    await conn.query(
      'UPDATE jobs SET total_due = $1, amount_paid = $2, balance = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [nextTotal, nextPaid, nextBalance, defaultJob.id]
    );
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  // Undo may insert a payment-delta row for the current year, and the
  // client balance change belongs to its creation year — refresh both.
  const paymentYear = new Date().getFullYear();
  const clientYear = new Date(clientRow.created_at || Date.now()).getFullYear();
  const yearsToUpdate = [...new Set([paymentYear, clientYear])];
  for (const y of yearsToUpdate) {
    await updateFinanceTotals(y);
  }

  const updatedClientResult = await db.query('SELECT total_due, amount_paid, balance FROM clients WHERE id = $1', [id]);
  return res.json({ success: true, client: updatedClientResult.rows[0], financeUpdated: true });
}));

// ======================================================
// FINANCE PAGE ROUTES
// ======================================================

// Available Years
router.get('/finance/years', requireAdmin, asyncHandler(async (req, res) => {
  try {
    await db.schemaReady;

    const clientYearsResult = await db.query('SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int AS year FROM clients');
    const jobYearsResult = await db.query('SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int AS year FROM jobs');
    const paymentYearsResult = await db.query('SELECT DISTINCT EXTRACT(YEAR FROM payment_date)::int AS year FROM payments');
    const overrideYearsResult = await db.query('SELECT year FROM finance_overrides WHERE year IS NOT NULL');

    const clientYears = clientYearsResult.rows.map((r) => Number(r.year));
    const jobYears = jobYearsResult.rows.map((r) => Number(r.year));
    const paymentYears = paymentYearsResult.rows.map((r) => Number(r.year));
    const overrideYears = overrideYearsResult.rows.map((r) => Number(r.year));

    const allYears = [...clientYears, ...jobYears, ...paymentYears, ...overrideYears];
    const uniqueYears = [...new Set(allYears.filter((y) => Number.isInteger(y) && y > 0))];

    const currentYear = new Date().getFullYear();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);

    uniqueYears.sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch years' });
  }
}));

// Save Year Data (Manual Override)
router.post('/finance/save', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const year = parseYear(req.body.year, 'year');
  const totalExpected = parseNumberField(req.body.totalExpected ?? 0, 'totalExpected', { required: false, defaultValue: 0 });
  const totalReceived = parseNumberField(req.body.totalReceived ?? 0, 'totalReceived', { required: false, defaultValue: 0 });
  const totalRemaining = parseNumberField(req.body.totalRemaining ?? 0, 'totalRemaining', { required: false, defaultValue: 0 });
  const totalClients = parseIntField(req.body.totalClients ?? 0, 'totalClients', { required: false, min: 0 });
  const overhead = parseNumberField(req.body.overhead ?? 0, 'overhead', { required: false, defaultValue: 0, min: 0 });

  try {
    await db.schemaReady;
    await db.query(`
      INSERT INTO finance_overrides (year, total_expected, total_received, total_remaining, total_clients, overhead)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(year) DO UPDATE SET
        total_expected = EXCLUDED.total_expected,
        total_received = EXCLUDED.total_received,
        total_remaining = EXCLUDED.total_remaining,
        total_clients = EXCLUDED.total_clients,
        overhead = EXCLUDED.overhead,
        updated_at = CURRENT_TIMESTAMP
    `, [year, totalExpected, totalReceived, totalRemaining, totalClients, overhead]);

    return res.json({ success: true });
  } catch (err) {
    console.error('Finance save error:', err);
    return res.status(500).json({ error: 'Failed to save finance data' });
  }
}));

// ======================================================
// UPDATED FINANCE SUMMARY (CUMULATIVE BALANCES)
// ======================================================
router.get('/finance/summary', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);

  try {
    await db.schemaReady;
    const yearSummary = await getFinanceTotalsForYear(year);

    const overrideResult = await db.query('SELECT * FROM finance_overrides WHERE year = $1', [year]);

    const override = overrideResult.rows[0];

    const finalSummary = override || {
      total_clients: yearSummary.total_clients,
      total_expected: yearSummary.total_expected,
      total_received: yearSummary.total_received,
      total_remaining: yearSummary.total_remaining
    };

    // Total job cost for the year
    const jobCostResult = await db.query(`
      SELECT COALESCE(SUM(j.job_cost), 0)::double precision AS total_job_cost
      FROM jobs j
      WHERE EXTRACT(YEAR FROM j.created_at)::int = $1
    `, [year]);
    const totalJobCost = Number(jobCostResult.rows[0]?.total_job_cost || 0);
    const overhead = Number(override?.overhead || 0);

    return res.json({
      mode: 'project',
      year,
      totalClients: Number(finalSummary.total_clients || finalSummary.totalClients || 0),
      totalExpected: Number(finalSummary.total_expected || finalSummary.totalExpected || 0),
      totalReceived: Number(finalSummary.total_received || finalSummary.totalReceived || 0),
      totalRemaining: Number(finalSummary.total_remaining || finalSummary.totalRemaining || 0),
      totalJobCost,
      overhead,
      avgMarginPct: await (async () => {
        try {
          const r = await db.query(`
            SELECT AVG(m.margin_pct) AS avg_margin
            FROM (
              SELECT
                j.id,
                (COALESCE(SUM(p.amount), 0) - COALESCE(SUM(e.amount), 0) - j.job_cost) /
                  NULLIF(COALESCE(SUM(p.amount), 0), 0) * 100 AS margin_pct
              FROM jobs j
              LEFT JOIN payments p ON p.job_id = j.id
              LEFT JOIN finance_margin_entries e ON e.job_id = j.id
              WHERE EXTRACT(YEAR FROM j.created_at)::int = $1
              GROUP BY j.id, j.job_cost
              HAVING COALESCE(SUM(p.amount), 0) > 0
            ) m
          `, [year]);
          const raw = r.rows[0]?.avg_margin;
          return raw != null ? Math.round(Number(raw) * 10) / 10 : null;
        } catch { return null; }
      })()
    });
  } catch (err) {
    console.error('Finance summary error:', err);
    return res.status(500).json({ error: 'Failed to fetch project summary' });
  }
}));

// ======================================================
// CASH SUMMARY
// ======================================================
router.get('/finance/cash-summary', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);
  try {
    await db.schemaReady;
    const summaryResult = await db.query(`
      SELECT
        COUNT(DISTINCT client_id)::int AS paying_clients,
        COALESCE(SUM(amount), 0) AS total_cash_received
      FROM payments
      WHERE EXTRACT(YEAR FROM payment_date)::int = $1
    `, [year]);

    const summary = summaryResult.rows[0] || {};

    return res.json({
      mode: 'cash',
      year,
      payingClients: Number(summary.paying_clients || 0),
      totalCashReceived: Number(summary.total_cash_received || 0)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch cash summary' });
  }
}));

// ======================================================
// SALES REVENUE BY SALESPERSON
// ======================================================
router.get('/finance/sales-revenue', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);
  try {
    await db.schemaReady;
    const { rows } = await db.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        COALESCE(SUM(j.total_due), 0)::double precision AS total_revenue,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p
          WHERE p.job_id IN (SELECT id FROM jobs WHERE sales_user_id = u.id AND EXTRACT(YEAR FROM created_at)::int = $1)
        ), 0)::double precision AS total_received,
        COUNT(j.id)::int AS job_count
      FROM app_users u
      INNER JOIN jobs j ON j.sales_user_id = u.id AND EXTRACT(YEAR FROM j.created_at)::int = $1
      GROUP BY u.id, u.name, u.email
      ORDER BY total_revenue DESC
    `, [year]);
    return res.json({ year, sales: rows });
  } catch (err) {
    console.error('Sales revenue error:', err);
    return res.status(500).json({ error: 'Failed to fetch sales revenue' });
  }
}));

// ======================================================
// COST BREAKDOWN BY CATEGORY
// ======================================================
router.get('/finance/cost-breakdown', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);
  try {
    await db.schemaReady;

    // 1. Total job cost from jobs table
    const jobCostResult = await db.query(`
      SELECT COALESCE(SUM(j.job_cost), 0)::double precision AS total_job_cost
      FROM jobs j
      WHERE EXTRACT(YEAR FROM j.created_at)::int = $1
    `, [year]);

    // 2. Expense categories from finance_margin_entries
    const categoryResult = await db.query(`
      SELECT
        category,
        COALESCE(SUM(amount), 0)::double precision AS total
      FROM finance_margin_entries
      WHERE EXTRACT(YEAR FROM expense_date)::int = $1
      GROUP BY category
      ORDER BY total DESC
    `, [year]);

    // 3. Overhead from finance_overrides
    const overheadResult = await db.query(`
      SELECT COALESCE(overhead, 0)::double precision AS overhead
      FROM finance_overrides WHERE year = $1
    `, [year]);

    const totalJobCost = Number(jobCostResult.rows[0]?.total_job_cost || 0);
    const overhead = Number(overheadResult.rows[0]?.overhead || 0);
    const categories = categoryResult.rows || [];

    return res.json({
      year,
      totalJobCost,
      overhead,
      categories
    });
  } catch (err) {
    console.error('Cost breakdown error:', err);
    return res.status(500).json({ error: 'Failed to fetch cost breakdown' });
  }
}));

// ======================================================
// MARGIN TRACKER DATA
// ======================================================
const MARGIN_CATEGORIES = ['Labor', 'Marketing', 'Software', 'Contractors', 'Operations', 'Taxes', 'Misc'];
const MARGIN_INVOICE_STATUSES = ['Pending', 'Billed', 'Partially Paid', 'Paid', 'Overdue'];

function normalizeDateInput(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function parseBooleanish(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function normalizeMarginEntryRow(row, clientNameLookup = new Map()) {
  const clientId = row.client_id === null || row.client_id === undefined || row.client_id === '' ? null : Number(row.client_id);
  const resolvedClientName = row.client_name || (clientId !== null ? clientNameLookup.get(clientId) : '') || '';
  return {
    id: Number(row.id),
    client_id: clientId,
    client_name: resolvedClientName,
    category: row.category || 'Misc',
    project: row.project || '',
    invoice_status: row.invoice_status || 'Pending',
    amount: Number(row.amount || 0),
    expense_type: row.expense_type || 'one-time',
    recurring: parseBooleanish(row.recurring),
    expense_date: normalizeDateInput(row.expense_date),
    notes: row.notes || '',
    attachment_url: row.attachment_url || '',
    created_at: normalizeDateInput(row.created_at),
    updated_at: normalizeDateInput(row.updated_at)
  };
}

async function getMarginBaseData() {
  await db.schemaReady;
  const [clientsResult, paymentsResult] = await Promise.all([
    db.query('SELECT * FROM clients'),
    db.query('SELECT * FROM payments')
  ]);

  let entriesResult = { rows: [] };
  try {
    entriesResult = await db.query('SELECT * FROM finance_margin_entries');
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    if (!message.includes('finance_margin_entries') && !message.includes('does not exist') && err?.code !== '42P01') {
      throw err;
    }
    entriesResult = { rows: [] };
  }

  return {
    clients: clientsResult.rows || [],
    payments: paymentsResult.rows || [],
    expenses: entriesResult.rows || []
  };
}

async function resolveClientName(clientId) {
  if (clientId === null || clientId === undefined || clientId === '') return '';
  const { rows } = await db.query('SELECT * FROM clients');
  const client = rows.find((row) => Number(row.id) === Number(clientId));
  return client?.name || '';
}

router.get('/finance/margin/dashboard', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);
  try {
    const baseData = await getMarginBaseData();
    const clientNameLookup = new Map(baseData.clients.map((client) => [Number(client.id), client.name || '']));
    const expenses = baseData.expenses.map((row) => normalizeMarginEntryRow(row, clientNameLookup));
    return res.json({
      year,
      previousYear: year - 1,
      categories: MARGIN_CATEGORIES,
      invoiceStatuses: MARGIN_INVOICE_STATUSES,
      clients: baseData.clients,
      payments: baseData.payments,
      expenses
    });
  } catch (err) {
    console.error('Margin dashboard error:', err);
    return res.status(500).json({ error: 'Failed to fetch margin dashboard data' });
  }
}));

router.post('/finance/margin/entries', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = req.body.client_id ?? req.body.clientId ?? null;
  const parsedClientId = clientId === null || clientId === undefined || clientId === '' ? null : parseIntField(clientId, 'client_id', { min: 1, required: false });
  const clientNameInput = parseStringField(req.body.client_name ?? req.body.clientName ?? '', 'client_name', { required: false, maxLength: 260, defaultValue: '' });
  const category = parseStringField(req.body.category ?? 'Misc', 'category', { required: false, maxLength: 80, defaultValue: 'Misc' });
  const project = parseStringField(req.body.project ?? '', 'project', { required: false, maxLength: 120, defaultValue: '' });
  const invoiceStatus = parseStringField(req.body.invoice_status ?? req.body.invoiceStatus ?? 'Pending', 'invoice_status', { required: false, maxLength: 80, defaultValue: 'Pending' });
  const amount = parseNumberField(req.body.amount ?? 0, 'amount', { required: false, defaultValue: 0, min: 0 });
  const expenseType = parseStringField(req.body.expense_type ?? req.body.expenseType ?? 'one-time', 'expense_type', { required: false, maxLength: 40, defaultValue: 'one-time' });
  const recurring = parseBooleanish(req.body.recurring ?? false);
  const expenseDate = normalizeDateInput(req.body.expense_date ?? req.body.expenseDate, new Date().toISOString());
  const notes = parseStringField(req.body.notes ?? '', 'notes', { required: false, maxLength: 5000, defaultValue: '' });
  const attachmentUrl = parseStringField(req.body.attachment_url ?? req.body.attachmentUrl ?? '', 'attachment_url', { required: false, maxLength: 2000, defaultValue: '' });
  const resolvedClientName = clientNameInput || (parsedClientId ? await resolveClientName(parsedClientId) : '');

  await db.schemaReady;
  await db.query(`
    INSERT INTO finance_margin_entries (
      client_id, client_name, category, project, invoice_status,
      amount, expense_type, recurring, expense_date, notes, attachment_url,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [parsedClientId, resolvedClientName, category, project, invoiceStatus, amount, expenseType, recurring, expenseDate, notes, attachmentUrl, new Date().toISOString(), new Date().toISOString()]);

  return res.json({ success: true, marginUpdated: true });
}));

router.put('/finance/margin/entries/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const clientId = req.body.client_id ?? req.body.clientId ?? null;
  const parsedClientId = clientId === null || clientId === undefined || clientId === '' ? null : parseIntField(clientId, 'client_id', { min: 1, required: false });
  const clientNameInput = parseStringField(req.body.client_name ?? req.body.clientName ?? '', 'client_name', { required: false, maxLength: 260, defaultValue: '' });
  const category = parseStringField(req.body.category ?? 'Misc', 'category', { required: false, maxLength: 80, defaultValue: 'Misc' });
  const project = parseStringField(req.body.project ?? '', 'project', { required: false, maxLength: 120, defaultValue: '' });
  const invoiceStatus = parseStringField(req.body.invoice_status ?? req.body.invoiceStatus ?? 'Pending', 'invoice_status', { required: false, maxLength: 80, defaultValue: 'Pending' });
  const amount = parseNumberField(req.body.amount ?? 0, 'amount', { required: false, defaultValue: 0, min: 0 });
  const expenseType = parseStringField(req.body.expense_type ?? req.body.expenseType ?? 'one-time', 'expense_type', { required: false, maxLength: 40, defaultValue: 'one-time' });
  const recurring = parseBooleanish(req.body.recurring ?? false);
  const expenseDate = normalizeDateInput(req.body.expense_date ?? req.body.expenseDate, new Date().toISOString());
  const notes = parseStringField(req.body.notes ?? '', 'notes', { required: false, maxLength: 5000, defaultValue: '' });
  const attachmentUrl = parseStringField(req.body.attachment_url ?? req.body.attachmentUrl ?? '', 'attachment_url', { required: false, maxLength: 2000, defaultValue: '' });
  const resolvedClientName = clientNameInput || (parsedClientId ? await resolveClientName(parsedClientId) : '');

  await db.schemaReady;
  await db.query(`
    UPDATE finance_margin_entries
    SET client_id = $1, client_name = $2, category = $3, project = $4, invoice_status = $5,
        amount = $6, expense_type = $7, recurring = $8, expense_date = $9,
        notes = $10, attachment_url = $11, updated_at = CURRENT_TIMESTAMP
    WHERE id = $12
  `, [parsedClientId, resolvedClientName, category, project, invoiceStatus, amount, expenseType, recurring, expenseDate, notes, attachmentUrl, id]);

  return res.json({ success: true, marginUpdated: true });
}));

router.delete('/finance/margin/entries/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  await db.query('DELETE FROM finance_margin_entries WHERE id = $1', [id]);
  return res.json({ success: true, marginUpdated: true });
}));

// ======================================================
// NOTES ROUTES
// ======================================================
router.get('/clients/:id/notes', requireClientAccess(), asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(
    'SELECT id, content, created_at FROM notes WHERE client_id = $1 ORDER BY created_at DESC',
    [id]
  );
  return res.json(rows);
}));

router.post('/clients/:id/notes', requireClientAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const content = parseStringField(req.body.content, 'content', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  await db.query('INSERT INTO notes (client_id, content) VALUES ($1, $2)', [id, content]);
  return res.json({ success: true });
}));

router.put('/clients/:id/notes/:noteId', requireClientAccess(), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const content = parseStringField(req.body.content, 'content', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  const result = await db.query('UPDATE notes SET content = $1 WHERE id = $2 AND client_id = $3', [content, noteId, id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  return res.json({ success: true });
}));

router.delete('/clients/:id/notes/:noteId', requireClientAccess(), asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });

  await db.schemaReady;
  const result = await db.query('DELETE FROM notes WHERE id = $1 AND client_id = $2', [noteId, id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  return res.json({ success: true });
}));

module.exports = router;
