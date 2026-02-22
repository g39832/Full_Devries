const express = require('express');
const router = express.Router();
const db = require('./db');

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
// SEARCH CLIENTS
// ======================================================
router.get('/search', (req, res) => {
  const term = req.query.q || '';

  if (!term) {
    const clients = db.prepare(`
      SELECT * FROM clients
      ORDER BY created_at DESC
    `).all();
    return res.json(clients);
  }

  const clients = db.prepare(`
    SELECT * FROM clients
    WHERE name LIKE ?
       OR phone LIKE ?
       OR email LIKE ?
       OR address LIKE ?
    ORDER BY created_at DESC
  `).all(
    `%${term}%`,
    `%${term}%`,
    `%${term}%`,
    `%${term}%`
  );

  res.json(clients);
});

// ======================================================
// SAVE CLIENT
// ======================================================
router.post('/save-client', (req, res) => {
  const { fName, lName, name, phone, email, address, status, total_due } = req.body;
  const finalName = name || ((fName || "") + " " + (lName || "")).trim();

  if (!finalName) return res.status(400).json({ error: "Name required" });

  const total = Number(total_due) || 0;

  db.prepare(`
    INSERT INTO clients 
    (name, phone, email, address, status, total_due, amount_paid, balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, datetime('now'))
  `).run(
    finalName,
    phone,
    email,
    address,
    status || "Lead",
    total,
    total
  );

  res.json({ success: true });
});

// ======================================================
// UPDATE CLIENT
// ======================================================
router.post('/update-project', (req, res) => {
  const { id, fName, lName, name, phone, email, address, status, total_due } = req.body;
  const finalName = name || ((fName || "") + " " + (lName || "")).trim();

  const client = db.prepare(`
    SELECT amount_paid, total_due
    FROM clients
    WHERE id = ?
  `).get(id);

  if (!client) return res.status(404).json({ error: "Client not found" });

  const newTotal = typeof total_due !== "undefined"
    ? Number(total_due)
    : client.total_due;

  const newBalance = (newTotal || 0) - (client.amount_paid || 0);

  db.prepare(`
    UPDATE clients
    SET name = ?, phone = ?, email = ?, address = ?, status = ?, total_due = ?, balance = ?
    WHERE id = ?
  `).run(
    finalName,
    phone,
    email,
    address,
    status,
    newTotal || 0,
    newBalance,
    id
  );

  res.json({ success: true });
});

// ======================================================
// DELETE CLIENT
// ======================================================
router.post('/delete-client', (req, res) => {
  const { id } = req.body;

  db.prepare(`
    DELETE FROM clients
    WHERE id = ?
  `).run(id);

  res.json({ success: true });
});

// ======================================================
// UPDATE TOTAL DUE
// ======================================================
router.put('/clients/:id/total', (req, res) => {
  const id = req.params.id;
  const { total_due } = req.body;

  const client = db.prepare(`
    SELECT amount_paid
    FROM clients
    WHERE id = ?
  `).get(id);

  if (!client) return res.status(404).json({ error: "Client not found" });

  const total = Number(total_due) || 0;
  const newBalance = total - (client.amount_paid || 0);

  db.prepare(`
    UPDATE clients
    SET total_due = ?, balance = ?
    WHERE id = ?
  `).run(total, newBalance, id);

  res.json({ success: true });
});

// ======================================================
// RECORD PAYMENT
// ======================================================
router.put('/clients/:id/payment', (req, res) => {
  const id = req.params.id;
  const { payment } = req.body;

  const amount = Number(payment || 0);
  if (amount <= 0) {
    return res.status(400).json({ error: "Invalid payment amount" });
  }

  const client = db.prepare(`
    SELECT total_due, amount_paid
    FROM clients
    WHERE id = ?
  `).get(id);

  if (!client) return res.status(404).json({ error: "Client not found" });

  const newPaid = (client.amount_paid || 0) + amount;
  const newBalance = (client.total_due || 0) - newPaid;

  const transaction = db.transaction(() => {

    db.prepare(`
      INSERT INTO payments (client_id, amount, payment_date)
      VALUES (?, ?, datetime('now'))
    `).run(id, amount);

    db.prepare(`
      UPDATE clients
      SET amount_paid = ?, balance = ?
      WHERE id = ?
    `).run(newPaid, newBalance, id);
  });

  transaction();

  res.json({ success: true });
});

// ======================================================
// RESET BALANCE (FORCE RE-CALC)
// ======================================================
router.put('/clients/:id/reset-paid', (req, res) => {
  const id = req.params.id;

  const client = db.prepare(`
    SELECT total_due, amount_paid
    FROM clients
    WHERE id = ?
  `).get(id);

  if (!client) return res.status(404).json({ error: "Client not found" });

  const alreadyPaid = client.amount_paid || 0;

  const transaction = db.transaction(() => {

    // If money was previously paid, insert NEGATIVE entry
    if (alreadyPaid > 0) {
      db.prepare(`
        INSERT INTO payments (client_id, amount, payment_date)
        VALUES (?, ?, datetime('now'))
      `).run(id, -alreadyPaid);
    }

    // Forcefully reset client totals and recalc balance
    const newBalance = client.total_due; // always set balance = total_due
    db.prepare(`
      UPDATE clients
      SET amount_paid = 0,
          balance = ?
      WHERE id = ?
    `).run(newBalance, id);
  });

  transaction();

  console.log(`Reset API called for client ID: ${id}`);
  console.log('Before reset:', client);
  const after = db.prepare(`SELECT total_due, amount_paid, balance FROM clients WHERE id = ?`).get(id);
  console.log('After reset:', after);

  res.json({ success: true, client: after });
});

// ======================================================
// FINANCE PAGE: PROJECT SUMMARY
// ======================================================
router.get('/finance/summary', (req, res) => {
  const year = getValidYear(req.query.year);

  try {
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS totalClients,
        COALESCE(SUM(total_due), 0) AS totalExpected,
        COALESCE(SUM(amount_paid), 0) AS totalReceived,
        COALESCE(SUM(total_due - amount_paid), 0) AS totalRemaining
      FROM clients
      WHERE strftime('%Y', created_at) = ?
    `).get(year.toString());

    res.json({
      mode: "project",
      year,
      totalClients: summary.totalClients || 0,
      totalExpected: summary.totalExpected || 0,
      totalReceived: summary.totalReceived || 0,
      totalRemaining: summary.totalRemaining || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch project summary" });
  }
});

// ======================================================
// FINANCE PAGE: CASH SUMMARY
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
      mode: "cash",
      year,
      payingClients: summary.payingClients || 0,
      totalCashReceived: summary.totalCashReceived || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch cash summary" });
  }
});

// ======================================================
// NOTES ROUTES
// ======================================================
router.get('/clients/:id/notes', (req, res) => {
  const id = req.params.id;
  const notes = db.prepare(`
    SELECT id, content, created_at
    FROM notes
    WHERE client_id = ?
    ORDER BY created_at DESC
  `).all(id);

  res.json(notes);
});

router.post('/clients/:id/notes', (req, res) => {
  const id = req.params.id;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Note content required" });
  }

  db.prepare(`
    INSERT INTO notes (client_id, content)
    VALUES (?, ?)
  `).run(id, content.trim());

  res.json({ success: true });
});

router.put('/clients/:id/notes/:noteId', (req, res) => {
  const { id, noteId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Note content required" });
  }

  const result = db.prepare(`
    UPDATE notes
    SET content = ?
    WHERE id = ? AND client_id = ?
  `).run(content.trim(), noteId, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Note not found" });
  }

  res.json({ success: true });
});

router.delete('/clients/:id/notes/:noteId', (req, res) => {
  const { id, noteId } = req.params;

  const result = db.prepare(`
    DELETE FROM notes
    WHERE id = ? AND client_id = ?
  `).run(noteId, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Note not found" });
  }

  res.json({ success: true });
});

module.exports = router;