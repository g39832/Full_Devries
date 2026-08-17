const express = require('express');
const db = require('./db');
const { asyncHandler, parseIntField } = require('./request-utils');
const { buildInvoiceData, generateInvoicePDF } = require('../services/invoice');
const { normalizeCompanyProfile } = require('../services/company-profile');
const { requireJobAccess, requireClientAccess } = require('./authz');

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

async function handleJobDocumentGeneration(req, res, mode) {
  try {
    const jobId = req.params.jobId;

    await db.schemaReady;
    const { rows } = await db.query(`
      SELECT j.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email, c.address AS client_address
      FROM jobs j JOIN clients c ON c.id = j.client_id
      WHERE j.id = $1
    `, [jobId]);
    const job = rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const lineItems = (await db.query(
      'SELECT id, description, quantity, unit_price, amount, sort_order FROM job_line_items WHERE job_id = $1 ORDER BY sort_order ASC, id ASC',
      [jobId]
    )).rows;

    const storedCompanyProfile = await readStoredCompanyProfile();
    if (storedCompanyProfile?.logoUrl) {
      const match = storedCompanyProfile.logoUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (match) storedCompanyProfile.logoBase64 = match[1];
    }
    const normalizedProfile = normalizeCompanyProfile(storedCompanyProfile || {});

    const invoiceData = buildInvoiceData({ job, lineItems, companyProfile: normalizedProfile, mode });
    const pdfBuffer = await generateInvoicePDF(invoiceData, mode);

    const safeClientName = String(job.client_name || 'client')
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'client';

    const filename = `${safeClientName}-${jobId}-${invoiceData.invoiceNumber}.pdf`;

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

// Job-scoped documents (authoritative).
router.post('/jobs/:jobId/invoice', requireJobAccess(), asyncHandler((req, res) =>
  handleJobDocumentGeneration(req, res, 'invoice')
));

router.post('/jobs/:jobId/estimate', requireJobAccess(), asyncHandler((req, res) =>
  handleJobDocumentGeneration(req, res, 'estimate')
));

// Legacy client-scoped routes (kept for the older renderer): generate from the
// client's default (oldest) job, including its line items.
async function legacyClientDocument(req, res, mode) {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  await db.schemaReady;
  const job = (await db.query(
    'SELECT id FROM jobs WHERE client_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1',
    [clientId]
  )).rows[0];
  if (!job) return res.status(404).json({ error: 'Client has no jobs' });
  req.params.jobId = job.id;
  return handleJobDocumentGeneration(req, res, mode);
}

router.post('/send-invoice/:clientId', requireClientAccess(), asyncHandler((req, res) =>
  legacyClientDocument(req, res, 'invoice')
));

router.post('/send-estimate/:clientId', requireClientAccess(), asyncHandler((req, res) =>
  legacyClientDocument(req, res, 'estimate')
));

module.exports = router;
