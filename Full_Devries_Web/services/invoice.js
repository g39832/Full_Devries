const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { normalizeCompanyProfile } = require('./company-profile');

const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'assets', 'devries_pic.png');

const currencyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '$0.00';
  return `$${currencyFormatter.format(num)}`;
}

function formatDisplayDate(date = new Date()) {
  const resolved = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(resolved.getTime())) return '';
  return resolved.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
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
  const x = doc.page.margins.left;

  const blocks = content.split(/\n\s*\n/);
  blocks.forEach((block, index) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return;

    const bulletLines = lines.every((line) => /^(\-|\*|\u2022|\d+\.)\s+/.test(line));
    if (bulletLines) {
      const items = lines.map((line) => line.replace(/^(\-|\*|\u2022|\d+\.)\s+/, '').trim()).filter(Boolean);
      if (items.length) {
        doc.list(items, x + 12, doc.y, {
          bulletIndent: 12,
          textIndent: 18,
          width
        });
      }
    } else {
      doc.text(lines.join('\n'), x, doc.y, {
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

function drawHeading(doc, title) {
  const x = doc.page.margins.left;
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(13.5).fillColor('#1f2937').text(title, x, doc.y);
  doc.moveDown(0.5);
}

function drawInlineField(doc, label, value, { width } = {}) {
  const x = doc.page.margins.left;
  const y = doc.y;
  const availableWidth = typeof width === 'number' ? width : doc.page.width - doc.page.margins.left * 2;

  doc.font('Helvetica').fontSize(11).fillColor('#222222')
    .text(`${label}:`, x, y, { width: 74, continued: false });
  doc.font('Helvetica').fontSize(11).fillColor('#222222')
    .text(String(value || '—'), x + 74, y, {
      width: Math.max(0, availableWidth - 74),
      lineGap: 1.5
    });

  doc.y = Math.max(doc.y, y + 16);
}

function drawEmailLine(doc, value) {
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.font('Helvetica').fontSize(11).fillColor('#2563eb')
    .text(value, x, y, {
      link: value.startsWith('http') ? value : `mailto:${value}`,
      underline: true,
      width: doc.page.width - doc.page.margins.left * 2
    });
}

function drawSummaryLine(doc, label, value, { gapAfter = 0 } = {}) {
  const x = doc.page.margins.left;
  doc.font('Helvetica').fontSize(11).fillColor('#222222')
    .text(`${label}: ${value}`, x, doc.y, {
      width: doc.page.width - doc.page.margins.left * 2
    });
  if (gapAfter) doc.moveDown(gapAfter);
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
    const M = doc.page.margins.left;
    const contentWidth = doc.page.width - M * 2;
    const centerX = M + contentWidth / 2;
    const logoBuffer = resolveLogoBuffer(data);

    const businessName = String(data.businessName || '').trim();
    const businessAddress = String(data.businessAddress || '').trim();
    const businessPhone = String(data.businessPhone || '').trim();
    const businessEmail = String(data.businessEmail || '').trim();
    const clientName = String(data.clientName || '').trim();
    const clientAddress = String(data.clientAddress || '').trim();
    const clientPhone = String(data.clientPhone || '').trim();
    const clientEmail = String(data.clientEmail || '').trim();
    const workDescription = String(data.workDescription || '').trim();

    const total = Number(data.total || 0);
    const paid = Number(data.paid || 0);
    const balance = Number(data.balance || 0);
    const contractPrice = Number.isFinite(total - balance) ? total - balance : paid;
    const dumpFee = balance;
    const dateValue = data.date || formatDisplayDate();

    // Centered logo, then the company details stack underneath.
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, centerX - 52, 88, { fit: [104, 60] });
      } catch {
        // If the logo fails, continue with the text layout.
      }
    }

    doc.y = 166;
    if (businessName) {
      doc.font('Helvetica').fontSize(17.5).fillColor('#2b2f36')
        .text(businessName, M, doc.y, { width: contentWidth });
    }

    if (businessAddress) {
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(11).fillColor('#333333')
        .text(businessAddress, M, doc.y, { width: contentWidth });
    }

    if (businessPhone) {
      doc.font('Helvetica').fontSize(11).fillColor('#333333')
        .text(businessPhone, M, doc.y, { width: contentWidth });
    }

    if (businessEmail) {
      drawEmailLine(doc, businessEmail);
    }

    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(11).fillColor('#333333')
      .text(`Date: ${dateValue}`, M, doc.y, { width: contentWidth });

    drawHeading(doc, 'Customer Information');
    drawInlineField(doc, 'Name', clientName, { width: contentWidth });
    drawInlineField(doc, 'Address', clientAddress, { width: contentWidth });
    drawInlineField(doc, 'Phone', clientPhone, { width: contentWidth });

    if (clientEmail) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(11).fillColor('#2563eb')
        .text(clientEmail, M, y, {
          width: contentWidth,
          link: `mailto:${clientEmail}`,
          underline: true
        });
    }

    drawHeading(doc, isEstimate ? 'Scope of Work' : 'Work Completed');
    if (workDescription) {
      const lines = workDescription
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const listItems = lines.map((line) => line.replace(/^(\-|\*|\u2022|\d+\.)\s+/, '').trim()).filter(Boolean);
      const looksLikeList = lines.some((line) => /^(\-|\*|\u2022|\d+\.)\s+/.test(line));

      doc.font('Helvetica').fontSize(11).fillColor('#222222');
      if (looksLikeList) {
        doc.list(listItems, M + 12, doc.y, {
          width: contentWidth - 12,
          bulletIndent: 12,
          textIndent: 18
        });
      } else {
        writeWrappedBlock(doc, workDescription, {
          width: contentWidth,
          paragraphGap: 6,
          lineGap: 3
        });
      }
    } else {
      doc.font('Helvetica').fontSize(11).fillColor('#222222')
        .text('No scope of work provided.', M, doc.y, { width: contentWidth });
    }

    drawHeading(doc, isEstimate ? 'Estimate Summary' : 'Invoice Summary');
    drawSummaryLine(doc, 'Contract Price', formatMoney(contractPrice));
    drawSummaryLine(doc, 'Dump Fee', formatMoney(dumpFee), { gapAfter: 0.6 });
    drawSummaryLine(doc, 'Total', formatMoney(total), { gapAfter: 0.6 });
    drawSummaryLine(doc, 'Amount Paid', formatMoney(paid));
    drawSummaryLine(doc, 'Balance Due', formatMoney(balance), { gapAfter: 0.8 });

    doc.font('Helvetica').fontSize(11).fillColor('#222222')
      .text('Thank you for your business!', M, doc.y, { width: contentWidth });

    doc.end();
  });
}

function buildInvoiceData({ client, latestNote = null, companyProfile = {}, mode = 'invoice' }) {
  const company = normalizeCompanyProfile(companyProfile, process.env);
  const workDescription = String(client.scope_of_work || company.defaultScopeOfWork || '').trim() || 'No scope of work provided.';
  const prefix = mode === 'estimate' ? 'EST' : 'INV';

  return {
    businessName: company.businessName,
    businessAddress: company.businessAddress,
    businessPhone: company.businessPhone,
    businessEmail: company.businessEmail,
    logoBase64: company.logoBase64 || null,
    date: formatDisplayDate(new Date()),
    invoiceNumber: `${prefix}-${client.id}-${Date.now()}`,
    clientName: client.name || '',
    clientAddress: client.address || '',
    clientPhone: client.phone || '',
    clientEmail: client.email || '',
    workDescription,
    total: client.total ?? client.total_due ?? 0,
    paid: client.paid ?? client.amount_paid ?? 0,
    balance: client.balance ?? 0,
    latestNote
  };
}

module.exports = {
  buildInvoiceData,
  generateInvoicePDF
};
