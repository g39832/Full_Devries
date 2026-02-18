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
  const { name, phone, email, address, status } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Name required" });
  }

  db.prepare(`
    INSERT INTO clients (name, phone, email, address, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, phone, email, address, status || "Lead");

  res.json({ success: true });
});

// ======================================================
// UPDATE PROJECT
// ======================================================
router.post('/update-project', (req, res) => {
  const { id, name, phone, email, address, status } = req.body;

  db.prepare(`
    UPDATE clients
    SET name = ?,
        phone = ?,
        email = ?,
        address = ?,
        status = ?
    WHERE id = ?
  `).run(name, phone, email, address, status, id);

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

  db.prepare(`
    UPDATE clients
    SET total_due = ?,
        balance = total_due - amount_paid
    WHERE id = ?
  `).run(total_due, id);

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

  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const newPaid = (client.amount_paid || 0) + Number(payment);
  const newBalance = (client.total_due || 0) - newPaid;

  db.prepare(`
    UPDATE clients
    SET amount_paid = ?,
        balance = ?
    WHERE id = ?
  `).run(newPaid, newBalance, id);

  res.json({ success: true });
});

module.exports = router;
