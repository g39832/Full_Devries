const express = require('express');
const db = require('./db');
const { asyncHandler, assertObject, AppError } = require('./request-utils');
const { maskEmailConfig, normalizeEmailConfig } = require('../services/email-config');

const router = express.Router();
const SETTINGS_KEY = 'email_delivery_config';

async function readStoredConfig() {
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
  const stored = await readStoredConfig();
  const config = normalizeEmailConfig(stored || {});
  res.json({
    success: true,
    settings: maskEmailConfig(config)
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  assertObject(req.body);

  const stored = await readStoredConfig();
  const envFallback = normalizeEmailConfig({}, process.env);
  const provider = String(req.body.provider || stored?.provider || 'gmail').trim().toLowerCase();
  const defaults = provider === 'outlook'
    ? { smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false }
    : provider === 'gmail'
      ? { smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecure: false }
      : { smtpHost: '', smtpPort: 587, smtpSecure: false };

  const smtpHost = String(req.body.smtpHost || '').trim() || defaults.smtpHost;
  const fromEmailCandidate = String(req.body.fromEmail || '').trim();
  const smtpUser = String(req.body.smtpUser || fromEmailCandidate || stored?.smtpUser || envFallback.smtpUser || '').trim();
  const smtpPassword = String(req.body.smtpPassword || '').trim() || String(stored?.smtpPassword || envFallback.smtpPassword || '');
  const fromName = String(req.body.fromName || '').trim() || envFallback.fromName || 'Your Company Name';
  const fromEmail = fromEmailCandidate || smtpUser || String(stored?.fromEmail || envFallback.fromEmail || '');
  const replyToEmail = String(req.body.replyToEmail || '').trim() || fromEmail || smtpUser || String(stored?.replyToEmail || envFallback.replyToEmail || '');
  const smtpPort = Number(req.body.smtpPort || defaults.smtpPort);
  const smtpSecure = req.body.smtpSecure === true
    || req.body.smtpSecure === 'true'
    || req.body.smtpSecure === '1'
    || req.body.smtpSecure === 1
    || req.body.smtpSecure === 'on';

  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new AppError(400, 'SMTP port must be a number between 1 and 65535');
  }

  const finalConfig = normalizeEmailConfig({
    provider,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPassword,
    fromName,
    fromEmail,
    replyToEmail
  });

  if (!finalConfig.smtpUser) {
    throw new AppError(400, 'SMTP username is required');
  }

  if (!finalConfig.smtpPassword) {
    throw new AppError(400, 'SMTP password is required');
  }

  await db.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [SETTINGS_KEY, JSON.stringify(finalConfig)]
  );

  res.json({
    success: true,
    settings: maskEmailConfig(finalConfig)
  });
}));

module.exports = router;
