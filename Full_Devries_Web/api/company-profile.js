const express = require('express');
const db = require('./db');
const { asyncHandler, assertObject, AppError } = require('./request-utils');
const { normalizeCompanyProfile } = require('../services/company-profile');

const router = express.Router();
const SETTINGS_KEY = 'company_profile';

async function readStoredProfile() {
  await db.schemaReady;
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [SETTINGS_KEY]);
  const raw = rows[0]?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const stored = await readStoredProfile();
  const profile = normalizeCompanyProfile(stored || {});
  res.json({ success: true, settings: profile });
}));

router.post('/', asyncHandler(async (req, res) => {
  assertObject(req.body);

  const current = await readStoredProfile();
  const profile = normalizeCompanyProfile({
    businessName: String(req.body.businessName || current?.businessName || '').trim(),
    businessAddress: String(req.body.businessAddress || current?.businessAddress || '').trim(),
    businessPhone: String(req.body.businessPhone || current?.businessPhone || '').trim(),
    businessEmail: String(req.body.businessEmail || current?.businessEmail || '').trim(),
    logoUrl: String(req.body.logoUrl !== undefined ? req.body.logoUrl : (current?.logoUrl || '')).trim(),
    defaultScopeOfWork: String(req.body.defaultScopeOfWork !== undefined ? req.body.defaultScopeOfWork : (current?.defaultScopeOfWork || '')).trim()
  });

  if (!profile.businessName) {
    throw new AppError(400, 'Company name is required');
  }

  await db.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [SETTINGS_KEY, JSON.stringify(profile)]
  );

  res.json({ success: true, settings: profile });
}));

module.exports = router;
