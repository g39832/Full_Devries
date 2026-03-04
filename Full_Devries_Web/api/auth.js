// api/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { asyncHandler, assertObject, parseStringField, AppError } = require('./request-utils');

const router = express.Router();

// ===== ENSURE DEFAULT PASSWORD EXISTS =====
async function initializePassword() {
  await db.schemaReady;
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'admin_password'");
  if (rows[0]) return;

  const configuredPassword = process.env.DEFAULT_ADMIN_PASSWORD;
  if (configuredPassword && configuredPassword.trim()) {
    const defaultHash = bcrypt.hashSync(configuredPassword.trim(), 10);
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['admin_password', defaultHash]);
    console.log('Admin password initialized from DEFAULT_ADMIN_PASSWORD.');
    return;
  }

  const allowLegacyFallback = process.env.ALLOW_LEGACY_DEV_PASSWORD === 'true';
  if (process.env.NODE_ENV !== 'production' && allowLegacyFallback) {
    const defaultHash = bcrypt.hashSync('123007', 10);
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['admin_password', defaultHash]);
    console.warn('Legacy dev password fallback enabled.');
    return;
  }

  console.warn('Admin password is not initialized. Set DEFAULT_ADMIN_PASSWORD or create it via migration/setup.');
}

initializePassword().catch((err) => {
  console.error('Password initialization failed:', err);
});

// ===== LOGIN ROUTE =====
router.post('/login', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const password = parseStringField(req.body.password, 'password', { minLength: 1, maxLength: 256 });

  await db.schemaReady;
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'admin_password'");
  const row = rows[0];
  if (!row) throw new AppError(500, 'Password not initialized.');

  const match = bcrypt.compareSync(password, row.value);
  if (!match) {
    return res.json({ success: false, message: 'Incorrect password.' });
  }

  req.session.authenticated = true;
  return res.json({ success: true });
}));

// ===== CHANGE PASSWORD ROUTE =====
router.post('/change-password', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const currentPassword = parseStringField(req.body.currentPassword, 'currentPassword', { minLength: 1, maxLength: 256 });
  const newPassword = parseStringField(req.body.newPassword, 'newPassword', { minLength: 4, maxLength: 256 });

  await db.schemaReady;
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'admin_password'");
  const row = rows[0];
  if (!row) throw new AppError(500, 'Password not initialized.');

  const match = bcrypt.compareSync(currentPassword, row.value);
  if (!match) return res.json({ success: false, message: 'Current password incorrect.' });

  const newHash = bcrypt.hashSync(newPassword, 10);
  await db.query("UPDATE settings SET value = $1 WHERE key = 'admin_password'", [newHash]);

  return res.json({ success: true });
}));

module.exports = router;