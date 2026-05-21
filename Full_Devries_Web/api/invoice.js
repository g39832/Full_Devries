const express = require('express');
const db = require('./db');
const { asyncHandler } = require('./request-utils');
const { buildInvoiceData, generateInvoicePDF } = require('../services/invoice');
const { normalizeCompanyProfile } = require('../services/company-profile');

const router = express.Router();

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const { createClient } = require('@supabase/supabase-js');
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}
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
  const { data, error } = await getSupabase()
    .from('notes')
    .select('id, content, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function handleDocumentGeneration(req, res, mode) {
  try {
    const { clientId } = req.params;

    const { data: client, error } = await getSupabase()
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (error || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // scope_of_work is always authoritative in the local DB — always read it from there
    await db.schemaReady;
    const { rows: localRows } = await db.query(
      'SELECT scope_of_work, job_cost FROM clients WHERE id = $1',
      [clientId]
    );
    if (localRows[0]) {
      client.scope_of_work = localRows[0].scope_of_work || client.scope_of_work || '';
      if (client.job_cost === undefined || client.job_cost === null) {
        client.job_cost = localRows[0].job_cost;
      }
    }

    const latestNote = await fetchLatestNote(clientId);
    const storedCompanyProfile = await readStoredCompanyProfile();
    const normalizedProfile = normalizeCompanyProfile(storedCompanyProfile || {});

    // Attach base64 logo if stored
    if (storedCompanyProfile?.logoUrl) {
      const match = storedCompanyProfile.logoUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (match) normalizedProfile.logoBase64 = match[1];
    }

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
