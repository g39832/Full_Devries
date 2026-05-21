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

function writeWrappedBlock(doc, text, { width, paragraphGap = 6, lineGap = 2 } = {}) {
  const content = String(text || '').trim();
  if (!content) return;

  const blocks = content.split(/\n\s*\n/);
  blocks.forEach((block, index) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return;

    const bulletLines = lines.every((line) => /^(\-|\*|\u2022|\d+\.)\s+/.test(line));
    if (bulletLines) {
      const items = lines.map((line) => line.replace(/^(\-|\*|\u2022|\d+\.)\s+/, '').trim()).filter(Boolean);
      if (items.length) {
        doc.list(items, {
          bulletIndent: 12,
          textIndent: 18,
          width
        });
      }
    } else {
      doc.text(lines.join('\n'), {
        width,
        lineGap,
        paragraphGap
      });
    }

    if (index < blocks.length - 1) {
      doc.moveDown(0.4);
    }
  });
}

function writeFieldRow(doc, label, value, options = {}) {
  const { labelWidth = 120, width = 280 } = options;
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#6b7280').text(`${label}:`, { continued: true, width: labelWidth });
  doc.font('Helvetica').fontSize(10).fillColor('#111827').text(String(value || ''), {
    width: Math.max(0, width - labelWidth),
    lineGap: 1.5
  });
  if (doc.y <= y) doc.y = y + 14;
}

// ======================================================
// DRAW SECTION HEADING with divider line
// ======================================================
function drawSectionHeading(doc, title, contentWidth, sectionColor) {
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text(title);
  const lineY = doc.y + 3;
  doc.moveTo(doc.page.margins.left, lineY)
    .lineTo(doc.page.margins.left + contentWidth, lineY)
    .lineWidth(0.8)
    .strokeColor(sectionColor)
    .stroke();
  doc.moveDown(0.7);
}

// ======================================================
// DRAW SUMMARY ROW (label left, value right, properly aligned)
// ======================================================
function drawSummaryRow(doc, label, value, { pageMarginLeft, contentWidth, labelColor = '#6b7280', valueColor = '#111827', valueFontSize = 13, labelFontSize = 10, bold = true } = {}) {
  const rowY = doc.y;
  // Label on the left
  doc.font('Helvetica').fontSize(labelFontSize).fillColor(labelColor)
    .text(label, pageMarginLeft + 14, rowY, { width: contentWidth / 2 - 14 });
  // Value on the right, right-aligned
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(valueFontSize).fillColor(valueColor)
    .text(`$${value}`, pageMarginLeft, rowY, { width: contentWidth - 14, align: 'right' });
  doc.y = rowY + valueFontSize + 8;
}

// ======================================================
// GENERATE INVOICE OR ESTIMATE PDF
// mode: 'invoice' | 'estimate'
// ======================================================
function generateInvoicePDF(data, mode = 'invoice') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 52, size: 'LETTER' });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const isEstimate = mode === 'estimate';
    const docTitle = isEstimate ? 'ESTIMATE' : 'INVOICE';
    const totalLabel = isEstimate ? 'Estimated Total' : 'Total';
    const paidLabel = isEstimate ? 'Deposit / Down Payment' : 'Amount Paid';
    const sectionColor = '#cbd5e1';
    const M = doc.page.margins.left;
    const contentWidth = doc.page.width - M * 2;

    // ================================================================
    // HEADER: Logo + Company info (left) | Doc title + number (right)
    // ================================================================
    const headerTopY = M;
    let logoDrawn = false;
    const logoBuffer = resolveLogoBuffer(data);
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, M, headerTopY, { fit: [90, 56] });
        logoDrawn = true;
      } catch (e) { /* skip bad logo */ }
    }

    const companyX = logoDrawn ? M + 100 : M;
    const companyMaxWidth = contentWidth / 2 - (logoDrawn ? 100 : 0);

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827')
      .text(data.businessName, companyX, headerTopY, { width: companyMaxWidth });
    doc.font('Helvetica').fontSize(9.5).fillColor('#4b5563')
      .text(data.businessAddress, companyX, doc.y + 2, { width: companyMaxWidth })
      .text(data.businessPhone, companyX, doc.y + 1, { width: companyMaxWidth })
      .text(data.businessEmail, companyX, doc.y + 1, { width: companyMaxWidth });

    // Doc title block — right side, aligned to top of header
    const titleBlockWidth = contentWidth / 2;
    const titleBlockX = M + contentWidth - titleBlockWidth;
    doc.font('Helvetica-Bold').fontSize(26).fillColor('#111827')
      .text(docTitle, titleBlockX, headerTopY, { width: titleBlockWidth, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#374151')
      .text(`Date: ${data.date}`, titleBlockX, doc.y + 4, { width: titleBlockWidth, align: 'right' })
      .text(`${docTitle} #: ${data.invoiceNumber}`, titleBlockX, doc.y + 2, { width: titleBlockWidth, align: 'right' });

    // Move below the taller of the two header columns
    doc.y = Math.max(doc.y, headerTopY + 80) + 18;

    // Full-width divider
    doc.moveTo(M, doc.y).lineTo(M + contentWidth, doc.y)
      .lineWidth(1.2).strokeColor('#e2e8f0').stroke();
    doc.moveDown(1.1);

    // ================================================================
    // CUSTOMER INFORMATION
    // ================================================================
    drawSectionHeading(doc, 'Customer Information', contentWidth, sectionColor);
    writeFieldRow(doc, 'Name',    data.clientName,    { labelWidth: 72, width: contentWidth });
    writeFieldRow(doc, 'Address', data.clientAddress, { labelWidth: 72, width: contentWidth });
    writeFieldRow(doc, 'Phone',   data.clientPhone,   { labelWidth: 72, width: contentWidth });
    writeFieldRow(doc, 'Email',   data.clientEmail,   { labelWidth: 72, width: contentWidth });

    // ================================================================
    // SCOPE OF WORK
    // ================================================================
    doc.moveDown(1.1);
    const workHeading = isEstimate ? 'Scope of Work' : 'Work Completed';
    drawSectionHeading(doc, workHeading, contentWidth, sectionColor);
    doc.font('Helvetica').fontSize(10.5).fillColor('#1f2937');
    writeWrappedBlock(doc, data.workDescription || 'No scope of work provided.', {
      width: contentWidth,
      paragraphGap: 7,
      lineGap: 3
    });

    // ================================================================
    // SUMMARY BOX
    // ================================================================
    doc.moveDown(1.2);
    const summaryHeading = isEstimate ? 'Estimate Summary' : 'Invoice Summary';
    drawSectionHeading(doc, summaryHeading, contentWidth, sectionColor);

    // Draw the box background
    const boxPad = 16;
    const rowH = 38;
    const boxHeight = rowH * 3 + boxPad;
    const boxY = doc.y;

    doc.roundedRect(M, boxY, contentWidth, boxHeight, 8)
      .lineWidth(0.8)
      .strokeColor('#d7dee8')
      .fillAndStroke('#f8fafc', '#d7dee8');

    // Row 1 — Total
    const r1Y = boxY + boxPad / 2;
    doc.font('Helvetica').fontSize(9.5).fillColor('#6b7280')
      .text(totalLabel, M + 16, r1Y, { width: contentWidth - 32 });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827')
      .text(`$${formatMoney(data.total)}`, M + 16, r1Y + 13, { width: contentWidth - 32 });

    // Row 1 right — Paid
    doc.font('Helvetica').fontSize(9.5).fillColor('#6b7280')
      .text(paidLabel, M, r1Y, { width: contentWidth - 16, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827')
      .text(`$${formatMoney(data.paid)}`, M, r1Y + 13, { width: contentWidth - 16, align: 'right' });

    // Thin divider between rows
    const divY = boxY + rowH + boxPad / 2;
    doc.moveTo(M + 16, divY).lineTo(M + contentWidth - 16, divY)
      .lineWidth(0.5).strokeColor('#e2e8f0').stroke();

    // Row 2 — Balance Due (highlighted)
    const r2Y = divY + 8;
    doc.font('Helvetica').fontSize(10).fillColor('#374151')
      .text('Balance Due', M + 16, r2Y, { width: contentWidth - 32 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827')
      .text(`$${formatMoney(data.balance)}`, M, r2Y, { width: contentWidth - 16, align: 'right' });

    doc.y = boxY + boxHeight + 20;

    // ================================================================
    // CLOSING LINE
    // ================================================================
    doc.moveTo(M, doc.y).lineTo(M + contentWidth, doc.y)
      .lineWidth(0.8).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.8);
    const closing = isEstimate
      ? 'Thank you for considering us. This estimate is valid for 30 days.'
      : 'Thank you for your business!';
    doc.font('Helvetica').fontSize(10.5).fillColor('#374151').text(closing, { align: 'center' });

    doc.end();
  });
}

function buildInvoiceData({ client, latestNote = null, companyProfile = {}, mode = 'invoice' }) {
  const company = normalizeCompanyProfile(companyProfile, process.env);
  // Prefer the saved client scope, then fall back to the company default scope.
  const workDescription = String(client.scope_of_work || company.defaultScopeOfWork || '').trim() || 'No scope of work provided.';
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
