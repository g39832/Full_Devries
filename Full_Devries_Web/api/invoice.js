const express = require('express');
const db = require('./db');
const { asyncHandler } = require('./request-utils');
const { buildInvoiceData, generateInvoicePDF } = require('../services/invoice');
const { normalizeCompanyProfile } = require('../services/company-profile');

const router = express.Router();

const COMPANY_PROFILE_KEY = 'company_profile';

async function readStoredCompanyProfile() {
  await db.schemaReady;
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [COMPANY_PROFILE_KEY]);
  const raw = rows[0]?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchLatestNote(clientId) {
  await db.schemaReady;
  const { rows } = await db.query(
    'SELECT id, content, created_at FROM notes WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1',
    [clientId]
  );
  return rows[0] || null;
}

async function handleDocumentGeneration(req, res, mode) {
  try {
    const clientId = req.params.clientId;

    await db.schemaReady;
    const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    const client = rows[0];

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const latestNote = await fetchLatestNote(clientId);
    const storedCompanyProfile = await readStoredCompanyProfile();

    // Extract base64 logo from the stored data URL before normalizing
    if (storedCompanyProfile?.logoUrl) {
      const match = storedCompanyProfile.logoUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (match) storedCompanyProfile.logoBase64 = match[1];
    }

    const normalizedProfile = normalizeCompanyProfile(storedCompanyProfile || {});

    const invoiceData = buildInvoiceData({ client, latestNote, companyProfile: normalizedProfile, mode });
    const pdfBuffer = await generateInvoicePDF(invoiceData, mode);

    const safeClientName = String(client.name || 'client')
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'client';

    const filename = `${safeClientName}-${invoiceData.invoiceNumber}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`
    });

    return res.send(pdfBuffer);
  } catch (err) {
    console.error(`${mode} generation failed:`, err);
    res.status(500).json({ error: `Failed to generate ${mode}` });
  }
}

router.post('/send-invoice/:clientId', asyncHandler((req, res) =>
  handleDocumentGeneration(req, res, 'invoice')
));

router.post('/send-estimate/:clientId', asyncHandler((req, res) =>
  handleDocumentGeneration(req, res, 'estimate')
));

module.exports = router;
