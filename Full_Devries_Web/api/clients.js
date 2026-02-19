const express = require('express');
const router = express.Router();
const db = require('./db');

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

  db.prepare(`
    INSERT INTO clients (name, phone, email, address, status, total_due, amount_paid, balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, datetime('now'))
  `).run(
    finalName,
    phone,
    email,
    address,
    status || "Lead",
    total_due || 0,
    total_due || 0 // initial balance = total_due
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

  const newTotal = typeof total_due !== "undefined" ? total_due : client.total_due;
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

  const newBalance = (total_due || 0) - (client.amount_paid || 0);

  db.prepare(`
    UPDATE clients
    SET total_due = ?, balance = ?
    WHERE id = ?
  `).run(total_due || 0, newBalance, id);

  res.json({ success: true });
});

// ======================================================
// RECORD PAYMENT
// ======================================================
router.put('/clients/:id/payment', (req, res) => {
  const id = req.params.id;
  const { payment } = req.body;

  const client = db.prepare(`
    SELECT total_due, amount_paid
    FROM clients
    WHERE id = ?
  `).get(id);

  if (!client) return res.status(404).json({ error: "Client not found" });

  const newPaid = (client.amount_paid || 0) + Number(payment);
  const newBalance = (client.total_due || 0) - newPaid;

  db.prepare(`
    UPDATE clients
    SET amount_paid = ?, balance = ?
    WHERE id = ?
  `).run(newPaid, newBalance, id);

  res.json({ success: true });
});

// ======================================================
// FINANCE PAGE: GET ALL CLIENTS
// ======================================================
router.get('/finance/clients', (req, res) => {
  try {
    const clients = db.prepare(`
      SELECT id,
             name,
             total_due AS expectedPayment,
             amount_paid AS receivedPayment,
             (total_due - amount_paid) AS balance,
             strftime('%Y', created_at) AS year
      FROM clients
      ORDER BY created_at DESC
    `).all();

    res.json(clients);
  } catch (err) {
    console.error("Failed to fetch finance clients:", err);
    res.status(500).json({ error: 'Failed to fetch finance clients' });
  }
});

// ======================================================
// FINANCE PAGE: GET SUMMARY (optimized)
// ======================================================
router.get('/finance/summary', (req, res) => {
  const year = req.query.year || new Date().getFullYear();

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
      year: year,
      totalClients: summary.totalClients,
      totalExpected: summary.totalExpected,
      totalReceived: summary.totalReceived,
      totalRemaining: summary.totalRemaining
    });
  } catch (err) {
    console.error("Failed to fetch finance summary:", err);
    res.status(500).json({ error: "Failed to fetch finance summary" });
  }
});

module.exports = router;
