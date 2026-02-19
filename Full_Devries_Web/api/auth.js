// api/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

const router = express.Router();

// ===== ENSURE DEFAULT PASSWORD EXISTS =====
function initializePassword() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
  if (!row) {
    const defaultHash = bcrypt.hashSync("123007", 10);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("admin_password", defaultHash);
    console.log("✅ Default admin password created: 123007");
  }
}

initializePassword();

// ===== LOGIN ROUTE =====
// Full route: POST /api/auth/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: "Password required." });

  const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
  if (!row) return res.status(500).json({ success: false, message: "Password not initialized." });

  const match = bcrypt.compareSync(password, row.value);
  if (match) {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: "Incorrect password." });
  }
});

// ===== CHANGE PASSWORD ROUTE =====
// Full route: POST /api/auth/change-password
router.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: "Both current and new password are required." });
  }

  const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
  if (!row) return res.status(500).json({ success: false, message: "Password not initialized." });

  const match = bcrypt.compareSync(currentPassword, row.value);
  if (!match) return res.json({ success: false, message: "Current password incorrect." });

  if (newPassword.length < 4) return res.json({ success: false, message: "New password must be at least 4 characters." });

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password'").run(newHash);

  res.json({ success: true });
});

module.exports = router;
