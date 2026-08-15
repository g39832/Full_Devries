// api/auth.js
const express = require('express');
const db = require('./db');
const { asyncHandler, assertObject, parseStringField, AppError } = require('./request-utils');

const router = express.Router();

// ======================================================
// ROLES
// ======================================================
const ROLE_ADMIN = 'admin';
const ROLE_USER = 'user';

// ======================================================
// SESSION USER HELPERS
// ======================================================
function getSessionUser(req) {
  const user = req.session && req.session.user;
  if (!user || req.session.authenticated !== true) return null;
  return user;
}

function requireRole(role) {
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (user.role !== role) {
      return res.status(403).json({ success: false, error: 'Forbidden: admin access required' });
    }
    return next();
  };
}

async function resolveAdminEmails() {
  try {
    await db.schemaReady;
    const { rows } = await db.query("SELECT value FROM settings WHERE key = 'admin_emails'");
    const stored = (rows[0]?.value || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const env = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    return [...new Set([...stored, ...env])];
  } catch {
    return (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  }
}

/**
 * Upsert an app user and resolve their role.
 * Only explicitly configured admin emails (ADMIN_EMAILS / admin_emails
 * setting) become admins on login. Users promoted by an admin via the
 * Users settings tab keep their stored role (never auto-demoted);
 * everyone else is a normal 'user'.
 */
async function ensureAppUser({ email, name = '', googleId = null }) {
  await db.schemaReady;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new AppError(400, 'Email is required');

  const adminEmails = await resolveAdminEmails();
  const role = adminEmails.includes(normalizedEmail) ? ROLE_ADMIN : ROLE_USER;

  const { rows } = await db.query(`
    INSERT INTO app_users (email, name, google_id, role, last_login_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT (email) DO UPDATE SET
      name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE app_users.name END,
      google_id = COALESCE(EXCLUDED.google_id, app_users.google_id),
      role = CASE WHEN app_users.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
      last_login_at = CURRENT_TIMESTAMP
    RETURNING id, email, name, role, is_active, google_id
  `, [normalizedEmail, String(name || '').trim(), googleId, role]);

  const user = rows[0];
  if (!user) throw new AppError(500, 'Failed to create user session');
  if (user.is_active === false) throw new AppError(403, 'Account is disabled');

  return {
    id: Number(user.id),
    email: user.email,
    name: user.name || user.email,
    role: user.role,
    googleId: user.google_id || null
  };
}

function openSession(req, user) {
  req.session.authenticated = true;
  req.session.user = user;
}

// ======================================================
// GOOGLE OAUTH — verify the Supabase session server-side
// ======================================================
async function verifyGoogleToken(accessToken) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !anonKey) {
    throw new AppError(503, 'Google login is not configured. Ask an administrator to enable it (see manual setup steps).');
  }
  if (!accessToken) throw new AppError(400, 'Missing access token');

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new AppError(401, 'Google session could not be verified with Supabase.');
  }

  const user = await response.json();
  if (!user || !user.email) {
    throw new AppError(401, 'Google session is missing an email address.');
  }

  const identity = (user.identities || []).find((i) => i.provider === 'google') || {};
  return {
    email: String(user.email).toLowerCase(),
    name: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email).trim(),
    googleId: identity.id || identity.provider_id || user.id || null
  };
}

router.post('/google/session', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const accessToken = parseStringField(req.body.accessToken ?? '', 'accessToken', { minLength: 1, maxLength: 8192 });

  const profile = await verifyGoogleToken(accessToken);
  const user = await ensureAppUser({ ...profile });
  openSession(req, user);

  return res.json({ success: true, user, isNewUser: true });
}));

// ======================================================
// LOGOUT
// ======================================================
router.post('/logout', asyncHandler(async (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ success: false, error: 'Failed to log out' });
    }
    res.clearCookie('devries.sid');
    return res.json({ success: true });
  });
}));

// ======================================================
// CURRENT USER (for UI role gating)
// ======================================================
router.get('/me', asyncHandler(async (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  return res.json({ success: true, user });
}));

module.exports = {
  router,
  getSessionUser,
  requireRole,
  ROLE_ADMIN,
  ROLE_USER
};
