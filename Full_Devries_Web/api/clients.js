const express = require('express');
const router = express.Router();
const db = require('./db');
const { asyncHandler, assertObject, parseIntField, parseNumberField, parseStringField, parseYear } = require('./request-utils');

// ======================================================
// HELPER: SAFE YEAR HANDLER
// ======================================================
function getValidYear(inputYear) {
  const currentYear = new Date().getFullYear();
  const parsed = parseInt(inputYear);
  return !parsed || parsed < 2000 || parsed > currentYear + 5
    ? currentYear
    : parsed;
}

// ======================================================
// HELPER: UPDATE FINANCE TOTALS FOR A YEAR
// ======================================================
function updateFinanceTotals(year) {
  year = getValidYear(year);

  // Total clients created in that year
  const clientSummary = db.prepare(`
    SELECT
      COUNT(*) AS totalClients,
      COALESCE(SUM(total_due), 0) AS totalExpected,
      COALESCE(SUM(balance), 0) AS totalRemaining
    FROM clients
    WHERE strftime('%Y', created_at) = ?
  `).get(year.toString());

  // Payments made in that year
  const paymentSummary = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS totalReceived
    FROM payments
    WHERE strftime('%Y', payment_date) = ?
  `).get(year.toString());

  // Upsert totals into finance_overrides
  db.prepare(`
    INSERT INTO finance_overrides (year, total_expected, total_received, total_remaining, total_clients)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(year) DO UPDATE SET
      total_expected=excluded.total_expected,
      total_received=excluded.total_received,
      total_remaining=excluded.total_remaining,
      total_clients=excluded.total_clients
  `).run(
    year,
    clientSummary.totalExpected,
    paymentSummary.totalReceived,
    clientSummary.totalRemaining,
    clientSummary.totalClients
  );
}

// ======================================================
// SEARCH CLIENTS
// ======================================================
router.get('/search', asyncHandler(async (req, res) => {
  const term = parseStringField(req.query.q ?? '', 'q', { required: false, maxLength: 200, defaultValue: '' });
  if (!term) return res.json(db.prepare(`SELECT * FROM clients ORDER BY created_at DESC`).all());

  const clients = db.prepare(`
    SELECT DISTINCT clients.* FROM clients
    LEFT JOIN notes ON notes.client_id = clients.id
    WHERE clients.name LIKE ?
       OR clients.phone LIKE ?
       OR clients.email LIKE ?
       OR clients.address LIKE ?
       OR notes.content LIKE ?
    ORDER BY clients.created_at DESC
  `).all(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);

  res.json(clients);
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
  const status = parseStringField(req.body.status ?? 'Lead', 'status', { required: false, maxLength: 30, defaultValue: 'Lead' });
  const totalDueInput = req.body.total_due;
  const finalName = name || `${fName} ${lName}`.trim();
  if (!finalName) return res.status(400).json({ error: 'Name required' });

  const total = parseNumberField(totalDueInput ?? 0, 'total_due', { required: false, defaultValue: 0 });
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO clients (name, phone, email, address, status, total_due, amount_paid, balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(finalName, phone, email, address, status || 'Lead', total, total, createdAt);

  // Update finance totals for the year of the new client
  const year = new Date(createdAt).getFullYear();
  updateFinanceTotals(year);

  res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// UPDATE CLIENT
// ======================================================
router.post('/update-project', asyncHandler(async (req, res) => {
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
  const finalName = name || `${fName} ${lName}`.trim();

  const client = db.prepare(`SELECT amount_paid, total_due, created_at FROM clients WHERE id = ?`).get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const newTotal = typeof totalDueInput !== 'undefined'
    ? parseNumberField(totalDueInput, 'total_due', { required: false, defaultValue: client.total_due })
    : client.total_due;
  const newBalance = (newTotal || 0) - (client.amount_paid || 0);

  db.prepare(`
    UPDATE clients
    SET name = ?, phone = ?, email = ?, address = ?, status = ?, total_due = ?, balance = ?
    WHERE id = ?
  `).run(finalName, phone, email, address, status, newTotal || 0, newBalance, id);

  // Update finance totals for this client’s year
  const year = new Date(client.created_at).getFullYear();
  updateFinanceTotals(year);

  res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// DELETE CLIENT
// ======================================================
router.post('/delete-client', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.body.id, 'id', { min: 1 });
  const client = db.prepare(`SELECT created_at FROM clients WHERE id = ?`).get(id);

  db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);

  if (client) {
    const year = new Date(client.created_at).getFullYear();
    updateFinanceTotals(year);
  }

  res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// UPDATE TOTAL DUE
// ======================================================
router.put('/clients/:id/total', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const total = parseNumberField(req.body.total_due, 'total_due', { required: false, defaultValue: 0 });

  const client = db.prepare(`SELECT amount_paid, created_at FROM clients WHERE id = ?`).get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const newBalance = total - (client.amount_paid || 0);

  db.prepare(`UPDATE clients SET total_due = ?, balance = ? WHERE id = ?`).run(total, newBalance, id);

  const year = new Date(client.created_at).getFullYear();
  updateFinanceTotals(year);

  res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// RECORD PAYMENT
// ======================================================
router.put('/clients/:id/payment', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const amount = parseNumberField(req.body.payment ?? 0, 'payment', { required: false, defaultValue: 0 });
  if (amount <= 0) return res.status(400).json({ error: 'Invalid payment amount' });

  const client = db.prepare(`SELECT total_due, amount_paid, created_at FROM clients WHERE id = ?`).get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const newPaid = (client.amount_paid || 0) + amount;
  const newBalance = (client.total_due || 0) - newPaid;

  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO payments (client_id, amount, payment_date) VALUES (?, ?, datetime('now'))`).run(id, amount);
    db.prepare(`UPDATE clients SET amount_paid = ?, balance = ? WHERE id = ?`).run(newPaid, newBalance, id);
  });
  transaction();

  const year = new Date().getFullYear();
  updateFinanceTotals(year);

  res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// RESET BALANCE (FORCE RE-CALC)
// ======================================================
router.put('/clients/:id/reset-paid', asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const client = db.prepare(`SELECT total_due, amount_paid, created_at FROM clients WHERE id = ?`).get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const alreadyPaid = client.amount_paid || 0;

  const transaction = db.transaction(() => {
    if (alreadyPaid > 0) {
      db.prepare(`INSERT INTO payments (client_id, amount, payment_date) VALUES (?, ?, datetime('now'))`).run(id, -alreadyPaid);
    }
    const newBalance = client.total_due;
    db.prepare(`UPDATE clients SET amount_paid = 0, balance = ? WHERE id = ?`).run(newBalance, id);
  });
  transaction();

  const year = new Date(client.created_at).getFullYear();
  updateFinanceTotals(year);

  const updatedClient = db.prepare(`SELECT total_due, amount_paid, balance FROM clients WHERE id = ?`).get(id);
  res.json({ success: true, client: updatedClient, financeUpdated: true });
}));

// ======================================================
// RESTORE FINANCE STATE (FOR UNDO)
// ======================================================
router.put('/clients/:id/finance-state', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const total_due = parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0 });
  const amount_paid = parseNumberField(req.body.amount_paid ?? 0, 'amount_paid', { required: false, defaultValue: 0 });

  const client = db.prepare(`SELECT total_due, amount_paid, created_at FROM clients WHERE id = ?`).get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const nextTotal = total_due;
  const nextPaid = amount_paid;
  const nextBalance = nextTotal - nextPaid;
  const deltaPaid = nextPaid - (client.amount_paid || 0);

  const transaction = db.transaction(() => {
    if (deltaPaid !== 0) {
      db.prepare(`INSERT INTO payments (client_id, amount, payment_date) VALUES (?, ?, datetime('now'))`).run(id, deltaPaid);
    }
    db.prepare(`UPDATE clients SET total_due = ?, amount_paid = ?, balance = ? WHERE id = ?`)
      .run(nextTotal, nextPaid, nextBalance, id);
  });
  transaction();

  const year = new Date(client.created_at).getFullYear();
  updateFinanceTotals(year);

  const updatedClient = db.prepare(`SELECT total_due, amount_paid, balance FROM clients WHERE id = ?`).get(id);
  res.json({ success: true, client: updatedClient, financeUpdated: true });
}));

// ======================================================
// FINANCE PAGE ROUTES
// ======================================================

// Available Years
router.get('/finance/years', asyncHandler(async (req, res) => {
  try {
    const clientYears = db.prepare(`SELECT DISTINCT strftime('%Y', created_at) AS year FROM clients`).all().map(r => parseInt(r.year));
    const paymentYears = db.prepare(`SELECT DISTINCT strftime('%Y', payment_date) AS year FROM payments`).all().map(r => parseInt(r.year));
    const overrideYears = db.prepare(`SELECT year FROM finance_overrides`).all().map(r => parseInt(r.year));

    const allYears = [...clientYears, ...paymentYears, ...overrideYears];
    const uniqueYears = [...new Set(allYears.filter(Boolean))];

    const currentYear = new Date().getFullYear();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);

    uniqueYears.sort((a, b) => b - a);
    res.json(uniqueYears);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch years' });
  }
}));

// Save Year Data (Manual Override)
router.post('/finance/save', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const year = parseYear(req.body.year, 'year');
  const totalExpected = parseNumberField(req.body.totalExpected ?? 0, 'totalExpected', { required: false, defaultValue: 0 });
  const totalReceived = parseNumberField(req.body.totalReceived ?? 0, 'totalReceived', { required: false, defaultValue: 0 });
  const totalRemaining = parseNumberField(req.body.totalRemaining ?? 0, 'totalRemaining', { required: false, defaultValue: 0 });
  const totalClients = parseIntField(req.body.totalClients ?? 0, 'totalClients', { required: false, min: 0 });

  try {
    db.prepare(`
      INSERT INTO finance_overrides (year, total_expected, total_received, total_remaining, total_clients)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(year) DO UPDATE SET
        total_expected=excluded.total_expected,
        total_received=excluded.total_received,
        total_remaining=excluded.total_remaining,
        total_clients=excluded.total_clients
    `).run(year, totalExpected, totalReceived, totalRemaining, totalClients);

    res.json({ success: true });
  } catch (err) {
    console.error("Finance save error:", err);
    res.status(500).json({ error: 'Failed to save finance data' });
  }
}));

// ======================================================
// UPDATED FINANCE SUMMARY (CUMULATIVE BALANCES)
// ======================================================
router.get('/finance/summary', asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);

  try {
    // Totals from ALL clients
    const clientSummary = db.prepare(`
      SELECT
        COUNT(*) AS totalClients,
        COALESCE(SUM(total_due), 0) AS totalExpected,
        COALESCE(SUM(balance), 0) AS totalRemaining
      FROM clients
    `).get();

    // Total received from payments in this year
    const paymentSummary = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS totalReceived
      FROM payments
      WHERE strftime('%Y', payment_date) = ?
    `).get(year.toString());

    // Use override if exists
    const override = db.prepare(`SELECT * FROM finance_overrides WHERE year = ?`).get(year);

    const finalSummary = override || {
      totalClients: clientSummary.totalClients,
      totalExpected: clientSummary.totalExpected,
      totalReceived: paymentSummary.totalReceived,
      totalRemaining: clientSummary.totalRemaining
    };

    res.json({
      mode: 'project',
      year,
      totalClients: finalSummary.total_clients ?? finalSummary.totalClients ?? 0,
      totalExpected: finalSummary.total_expected ?? finalSummary.totalExpected ?? 0,
      totalReceived: finalSummary.total_received ?? finalSummary.totalReceived ?? 0,
      totalRemaining: finalSummary.total_remaining ?? finalSummary.totalRemaining ?? 0
    });

  } catch (err) {
    console.error("Finance summary error:", err);
    res.status(500).json({ error: 'Failed to fetch project summary' });
  }
}));

// ======================================================
// CASH SUMMARY
// ======================================================
router.get('/finance/cash-summary', asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);
  try {
    const summary = db.prepare(`
      SELECT
        COUNT(DISTINCT client_id) AS payingClients,
        COALESCE(SUM(amount), 0) AS totalCashReceived
      FROM payments
      WHERE strftime('%Y', payment_date) = ?
    `).get(year.toString());

    res.json({
      mode: 'cash',
      year,
      payingClients: summary.payingClients || 0,
      totalCashReceived: summary.totalCashReceived || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch cash summary' });
  }
}));

// ======================================================
// NOTES ROUTES
// ======================================================
router.get('/clients/:id/notes', asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  res.json(db.prepare(`SELECT id, content, created_at FROM notes WHERE client_id = ? ORDER BY created_at DESC`).all(id));
}));

router.post('/clients/:id/notes', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const content = parseStringField(req.body.content, 'content', { minLength: 1, maxLength: 10000 });

  db.prepare(`INSERT INTO notes (client_id, content) VALUES (?, ?)`).run(id, content);
  res.json({ success: true });
}));

router.put('/clients/:id/notes/:noteId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const content = parseStringField(req.body.content, 'content', { minLength: 1, maxLength: 10000 });

  const result = db.prepare(`UPDATE notes SET content = ? WHERE id = ? AND client_id = ?`).run(content, noteId, id);
  if (result.changes === 0) return res.status(404).json({ error: 'Note not found' });
  res.json({ success: true });
}));

router.delete('/clients/:id/notes/:noteId', asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const result = db.prepare(`DELETE FROM notes WHERE id = ? AND client_id = ?`).run(noteId, id);
  if (result.changes === 0) return res.status(404).json({ error: 'Note not found' });
  res.json({ success: true });
}));

module.exports = router;
