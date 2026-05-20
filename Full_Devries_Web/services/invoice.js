const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { normalizeCompanyProfile } = require('./company-profile');

const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'assets', 'devries_pic.png');

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function resolveLogoBuffer(data) {
  if (data.logoBase64) {
    try {
      return Buffer.from(data.logoBase64, 'base64');
    } catch {
      // Fall through to the default brand asset if the stored logo is invalid.
    }
  }

  try {
    return fs.readFileSync(DEFAULT_LOGO_PATH);
  } catch {
    return null;
  }
}

// ======================================================
// GENERATE INVOICE OR ESTIMATE PDF
// mode: 'invoice' | 'estimate'
// ======================================================
function generateInvoicePDF(data, mode = 'invoice') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const isEstimate = mode === 'estimate';
    const docTitle = isEstimate ? 'ESTIMATE' : 'INVOICE';
    const totalLabel = isEstimate ? 'Estimated Total' : 'Total';
    const paidLabel = isEstimate ? 'Deposit / Down Payment' : 'Amount Paid';

    // ---- Logo ----
    let logoDrawn = false;
    const logoBuffer = resolveLogoBuffer(data);
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 48, 48, { width: 100, height: 60, fit: [100, 60] });
        logoDrawn = true;
      } catch (e) {
        // Logo failed to render - skip it
      }
    }

    // ---- Company header ----
    const headerX = logoDrawn ? 160 : 48;
    doc.fontSize(20).fillColor('#111827').text(data.businessName, headerX, 48);
    doc.fontSize(10).fillColor('#4b5563')
      .text(data.businessAddress, headerX)
      .text(data.businessPhone, headerX)
      .text(data.businessEmail, headerX);

    // ---- Document title ----
    doc.moveDown(logoDrawn ? 0.5 : 1.2);
    doc.fontSize(18).fillColor('#111827').text(docTitle, { align: 'right' });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#111827')
      .text(`Date: ${data.date}`)
      .text(`${docTitle} #: ${data.invoiceNumber}`);

    // ---- Customer info ----
    doc.moveDown(1);
    doc.fontSize(14).fillColor('#111827').text('Customer Information', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#111827')
      .text(`Name: ${data.clientName}`)
      .text(`Address: ${data.clientAddress}`)
      .text(`Phone: ${data.clientPhone}`)
      .text(`Email: ${data.clientEmail}`);

    // ---- Scope of work ----
    doc.moveDown(1);
    const workHeading = isEstimate ? 'Scope of Work' : 'Work Completed';
    doc.fontSize(14).fillColor('#111827').text(workHeading, { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#111827')
      .text(data.workDescription || 'No scope of work provided.');

    // ---- Summary ----
    doc.moveDown(1);
    const summaryHeading = isEstimate ? 'Estimate Summary' : 'Invoice Summary';
    doc.fontSize(14).fillColor('#111827').text(summaryHeading, { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#111827')
      .text(`${totalLabel}: $${formatMoney(data.total)}`)
      .text(`${paidLabel}: $${formatMoney(data.paid)}`)
      .text(`Balance Due: $${formatMoney(data.balance)}`);

    doc.moveDown(1.2);
    const closing = isEstimate
      ? 'Thank you for considering us. This estimate is valid for 30 days.'
      : 'Thank you for your business!';
    doc.fontSize(11).fillColor('#374151').text(closing);

    doc.end();
  });
}

function buildInvoiceData({ client, latestNote = null, companyProfile = {}, mode = 'invoice' }) {
  // Only use the client's scope_of_work - notes never appear on invoices/estimates
  const workDescription = client.scope_of_work || 'No scope of work provided.';

  const company = normalizeCompanyProfile(companyProfile, process.env);
  const prefix = mode === 'estimate' ? 'EST' : 'INV';

  return {
    businessName: company.businessName,
    businessAddress: company.businessAddress,
    businessPhone: company.businessPhone,
    businessEmail: company.businessEmail,
    logoBase64: company.logoBase64 || null,
    date: new Date().toLocaleDateString(),
    invoiceNumber: `${prefix}-${client.id}-${Date.now()}`,
    clientName: client.name || '',
    clientAddress: client.address || '',
    clientPhone: client.phone || '',
    clientEmail: client.email || '',
    workDescription,
    total: client.total ?? client.total_due ?? 0,
    paid: client.paid ?? client.amount_paid ?? 0,
    balance: client.balance ?? 0
  };
}

module.exports = {
  buildInvoiceData,
  generateInvoicePDF
};
