const express = require('express');
const router = express.Router();
const db = require('./db');

// ======================================================
// ENSURE FINANCE_OVERRIDES TABLE HAS REQUIRED COLUMNS
// ======================================================
function ensureFinanceOverridesColumns() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS finance_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER UNIQUE
    )
  `).run();

  const columnsToAdd = [
    { name: 'total_expected', type: 'REAL', default: 0 },
    { name: 'total_received', type: 'REAL', default: 0 },
    { name: 'total_remaining', type: 'REAL', default: 0 },
    { name: 'total_clients', type: 'INTEGER', default: 0 },
  ];

  const existingColumns = db.prepare(`PRAGMA table_info(finance_overrides)`).all().map(c => c.name);

  columnsToAdd.forEach(col => {
    if (!existingColumns.includes(col.name)) {
      db.prepare(`ALTER TABLE finance_overrides ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}`).run();
      console.log(`Added missing column '${col.name}' to finance_overrides`);
    }
  });
}

ensureFinanceOverridesColumns();

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
router.get('/search', (req, res) => {
  const term = req.query.q || '';
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
});

// ======================================================
// SAVE CLIENT
// ======================================================
router.post('/save-client', (req, res) => {
  const { fName, lName, name, phone, email, address, status, total_due } = req.body;
  const finalName = name || ((fName || '') + ' ' + (lName || '')).trim();
  if (!finalName) return res.status(400).json({ error: 'Name required' });

  const total = Number(total_due) || 0;
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO clients (name, phone, email, address, status, total_due, amount_paid, balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(finalName, phone, email, address, status || 'Lead', total, total, createdAt);

  // Update finance totals for the year of the new client
  const year = new Date(createdAt).getFullYear();
  updateFinanceTotals(year);

  res.json({ success: true, financeUpdated: true });
});

// ======================================================
// UPDATE CLIENT
// ======================================================
router.post('/update-project', (req, res) => {
  const { id, fName, lName, name, phone, email, address, status, total_due } = req.body;
  const finalName = name || ((fName || '') + ' ' + (lName || '')).trim();

  const client = db.prepare(`SELECT amount_paid, total_due, created_at FROM clients WHERE id = ?`).get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const newTotal = typeof total_due !== 'undefined' ? Number(total_due) : client.total_due;
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
});

// ======================================================
// DELETE CLIENT
// ======================================================
router.post('/delete-client', (req, res) => {
  const { id } = req.body;
  const client = db.prepare(`SELECT created_at FROM clients WHERE id = ?`).get(id);

  db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);

  if (client) {
    const year = new Date(client.created_at).getFullYear();
    updateFinanceTotals(year);
  }

  res.json({ success: true, financeUpdated: true });
});

// ======================================================
// UPDATE TOTAL DUE
// ======================================================
router.put('/clients/:id/total', (req, res) => {
  const id = req.params.id;
  const { total_due } = req.body;

  const client = db.prepare(`SELECT amount_paid, created_at FROM clients WHERE id = ?`).get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const total = Number(total_due) || 0;
  const newBalance = total - (client.amount_paid || 0);

  db.prepare(`UPDATE clients SET total_due = ?, balance = ? WHERE id = ?`).run(total, newBalance, id);

  const year = new Date(client.created_at).getFullYear();
  updateFinanceTotals(year);

  res.json({ success: true, financeUpdated: true });
});

// ======================================================
// RECORD PAYMENT
// ======================================================
router.put('/clients/:id/payment', (req, res) => {
  const id = req.params.id;
  const { payment } = req.body;

  const amount = Number(payment || 0);
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
});

// ======================================================
// RESET BALANCE (FORCE RE-CALC)
// ======================================================
router.put('/clients/:id/reset-paid', (req, res) => {
  const id = req.params.id;
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
});

// ======================================================
// FINANCE PAGE ROUTES
// ======================================================

// Available Years
router.get('/finance/years', (req, res) => {
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
});

// Save Year Data (Manual Override)
router.post('/finance/save', (req, res) => {
  const { year, totalExpected, totalReceived, totalRemaining, totalClients } = req.body;
  if (!year || isNaN(year)) return res.status(400).json({ error: 'Valid year required' });

  try {
    const expected = Number(totalExpected) || 0;
    const received = Number(totalReceived) || 0;
    const remaining = Number(totalRemaining) || 0;
    const clients = Number(totalClients) || 0;

    db.prepare(`
      INSERT INTO finance_overrides (year, total_expected, total_received, total_remaining, total_clients)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(year) DO UPDATE SET
        total_expected=excluded.total_expected,
        total_received=excluded.total_received,
        total_remaining=excluded.total_remaining,
        total_clients=excluded.total_clients
    `).run(year, expected, received, remaining, clients);

    res.json({ success: true });
  } catch (err) {
    console.error("Finance save error:", err);
    res.status(500).json({ error: 'Failed to save finance data' });
  }
});

// ======================================================
// UPDATED FINANCE SUMMARY (CUMULATIVE BALANCES)
// ======================================================
router.get('/finance/summary', (req, res) => {
  const year = getValidYear(req.query.year);

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
});

// ======================================================
// CASH SUMMARY
// ======================================================
router.get('/finance/cash-summary', (req, res) => {
  const year = getValidYear(req.query.year);
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
});

// ======================================================
// NOTES ROUTES
// ======================================================
router.get('/clients/:id/notes', (req, res) => {
  const id = req.params.id;
  res.json(db.prepare(`SELECT id, content, created_at FROM notes WHERE client_id = ? ORDER BY created_at DESC`).all(id));
});

router.post('/clients/:id/notes', (req, res) => {
  const id = req.params.id;
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Note content required' });

  db.prepare(`INSERT INTO notes (client_id, content) VALUES (?, ?)`).run(id, content.trim());
  res.json({ success: true });
});

router.put('/clients/:id/notes/:noteId', (req, res) => {
  const { id, noteId } = req.params;
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Note content required' });

  const result = db.prepare(`UPDATE notes SET content = ? WHERE id = ? AND client_id = ?`).run(content.trim(), noteId, id);
  if (result.changes === 0) return res.status(404).json({ error: 'Note not found' });
  res.json({ success: true });
});

router.delete('/clients/:id/notes/:noteId', (req, res) => {
  const { id, noteId } = req.params;
  const result = db.prepare(`DELETE FROM notes WHERE id = ? AND client_id = ?`).run(noteId, id);
  if (result.changes === 0) return res.status(404).json({ error: 'Note not found' });
  res.json({ success: true });
});

module.exports = router;