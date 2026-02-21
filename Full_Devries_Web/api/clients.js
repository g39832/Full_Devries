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
// RECORD PAYMENT (UPGRADED)
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
    // Insert into payments table (NEW)
    db.prepare(`
      INSERT INTO payments (client_id, amount, payment_date)
      VALUES (?, ?, datetime('now'))
    `).run(id, amount);

    // Update client totals (BACKWARD COMPATIBLE)
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
// FINANCE PAGE: PROJECT-BASED SUMMARY (UNCHANGED)
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
    console.error("Project summary error:", err);
    res.status(500).json({ error: "Failed to fetch project summary" });
  }
});

// ======================================================
// FINANCE PAGE: CASH-BASED SUMMARY (NEW)
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
    console.error("Cash summary error:", err);
    res.status(500).json({ error: "Failed to fetch cash summary" });
  }
});

module.exports = router;