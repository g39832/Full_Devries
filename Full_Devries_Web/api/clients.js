const express = require('express');
const router = express.Router();

// In-memory "database" for clients
let clients = [];
let idCounter = 1;

// ===== Search clients =====
router.get('/search', (req, res) => {
  const term = (req.query.q || '').toLowerCase();
  const filtered = clients.filter(c =>
    c.fName.toLowerCase().includes(term) ||
    c.lName.toLowerCase().includes(term) ||
    c.email.toLowerCase().includes(term) ||
    c.phone.toLowerCase().includes(term)
  );
  res.json(filtered);
});

// ===== Save new client =====
router.post('/save-client', (req, res) => {
  const client = { id: idCounter++, status: 'Lead', ...req.body };
  clients.push(client);
  res.json({ success: true, client });
});

// ===== Update client/project =====
router.post('/update-project', (req, res) => {
  const idx = clients.findIndex(c => c.id === req.body.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Client not found' });

  clients[idx] = { ...clients[idx], ...req.body };
  res.json({ success: true, client: clients[idx] });
});

// ===== Delete client =====
router.post('/delete-client', (req, res) => {
  const idx = clients.findIndex(c => c.id === req.body.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Client not found' });

  clients.splice(idx, 1);
  res.json({ success: true });
});

module.exports = router;
