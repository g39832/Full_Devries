// clients.js
const express = require('express');
const db = require('./db');
const router = express.Router();

// ===== Search clients =====
router.get('/search', (req, res) => {
  const term = (req.query.q || '').toLowerCase();
  const rows = db.prepare(`
    SELECT * FROM clients
    WHERE LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(phone) LIKE ?
    ORDER BY created_at DESC
  `).all(`%${term}%`, `%${term}%`, `%${term}%`);
  res.json(rows);
});

// ===== Save new client =====
router.post('/save-client', (req, res) => {
  const { name, email, phone, address, status } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, message: 'Name is required.' });
  }

  const stmt = db.prepare(`
    INSERT INTO clients (name, email, phone, address, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    name.trim(),
    email || '',
    phone || '',
    address || '',   // ✅ Save Job Address
    status || 'Lead'
  );

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
  res.json({ success: true, client });
});

// ===== Update client/project =====
router.post('/update-project', (req, res) => {
  const { id, name, email, phone, address, status } = req.body;

  if (!id) return res.status(400).json({ success: false, message: 'Client ID is required.' });

  const stmt = db.prepare(`
    UPDATE clients
    SET name = ?, email = ?, phone = ?, address = ?, status = ?
    WHERE id = ?
  `);

  const info = stmt.run(
    name || '',
    email || '',
    phone || '',
    address || '',   // ✅ Update Job Address
    status || 'Lead',
    id
  );

  if (info.changes === 0) return res.status(404).json({ success: false, message: 'Client not found.' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  res.json({ success: true, client });
});

// ===== Delete client =====
router.post('/delete-client', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, message: 'Client ID is required.' });

  const stmt = db.prepare('DELETE FROM clients WHERE id = ?');
  const info = stmt.run(id);

  if (info.changes === 0) return res.status(404).json({ success: false, message: 'Client not found.' });

  res.json({ success: true });
});

module.exports = router;
