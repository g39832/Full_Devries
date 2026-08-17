const PDFDocument = require('pdfkit');
const { normalizeCompanyProfile } = require('./company-profile');

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
  // Only use the uploaded business logo — never fall back to the placeholder
  // asset which renders with a black background.
  if (data.logoBase64) {
    try {
      return Buffer.from(data.logoBase64, 'base64');
    } catch {
      // Invalid base64 — fall through to text-only header
    }
  }
  return null;
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

function drawLineItemsTable(doc, items) {
  const list = (items || []).filter((li) => li && (li.description || Number(li.amount) > 0));
  if (!list.length) return;
  const M = doc.page.margins.left;
  const contentWidth = doc.page.width - M * 2;
  drawHeading(doc, 'Line Items');
  let subtotal = 0;
  list.forEach((li, i) => {
    const amount = Number(li.amount) || 0;
    subtotal += amount;
    const qty = Number(li.quantity) || 1;
    const line = `${i + 1}. ${String(li.description || 'Item').trim()} — ${qty} × ${formatMoney(li.unit_price)} = ${formatMoney(amount)}`;
    doc.font('Helvetica').fontSize(10.5).fillColor('#222222')
      .text(line, M, doc.y, { width: contentWidth, lineGap: 2 });
  });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
    .text(`Subtotal: ${formatMoney(subtotal)}`, M, doc.y, { width: contentWidth, align: 'right' });
  doc.moveDown(0.5);
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
    const dateValue = data.date || formatDisplayDate();

    // ================================================================
    // HEADER — logo centered if uploaded, otherwise text-only
    // ================================================================
    if (logoBuffer) {
      try {
        // Render with PNG transparency preserved — no background fill
        doc.image(logoBuffer, centerX - 80, 52, { fit: [160, 100] });
        doc.y = 168;
      } catch {
        doc.y = 52;
      }
    } else {
      // No logo — start text header from top margin
      doc.y = 52;
    }

    if (businessName) {
      doc.font('Helvetica-Bold').fontSize(17.5).fillColor('#1f2937')
        .text(businessName, M, doc.y, { width: contentWidth });
    }

    doc.moveDown(0.4);

    if (businessAddress) {
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

    // ================================================================
    // CUSTOMER INFORMATION
    // ================================================================
    drawHeading(doc, 'Customer Information');
    drawInlineField(doc, 'Name',    clientName,    { width: contentWidth });
    drawInlineField(doc, 'Address', clientAddress, { width: contentWidth });
    drawInlineField(doc, 'Phone',   clientPhone,   { width: contentWidth });
    if (clientEmail) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(11).fillColor('#2563eb')
        .text(clientEmail, M, y, {
          width: contentWidth,
          link: `mailto:${clientEmail}`,
          underline: true
        });
      doc.y = Math.max(doc.y, y + 16);
    }

    // ================================================================
    // SCOPE OF WORK
    // ================================================================
    drawHeading(doc, isEstimate ? 'Scope of Work' : 'Work Completed');
    if (workDescription) {
      const lines = workDescription
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const looksLikeList = lines.some((line) => /^(\-|\*|\u2022|\d+\.)\s+/.test(line));
      const listItems = lines.map((line) => line.replace(/^(\-|\*|\u2022|\d+\.)\s+/, '').trim()).filter(Boolean);

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

    // ================================================================
    // LINE ITEMS (job-scoped estimate/invoice breakdown)
    // ================================================================
    drawLineItemsTable(doc, data.lineItems);

    // ================================================================
    // SUMMARY — ESTIMATE vs INVOICE are different
    // ================================================================
    if (isEstimate) {
      // ESTIMATE: just show the total — no amount paid, no dump fee, no balance
      drawHeading(doc, 'Estimate Total');
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827')
        .text(formatMoney(total), M, doc.y, { width: contentWidth });

      doc.moveDown(1.2);
      doc.font('Helvetica').fontSize(10).fillColor('#555555')
        .text('This estimate is valid for 30 days. Prices subject to change based on final inspection.', M, doc.y, {
          width: contentWidth
        });

      doc.moveDown(1.4);

      // Acceptance signature block
      drawHeading(doc, 'Terms & Acceptance');
      doc.font('Helvetica').fontSize(11).fillColor('#222222')
        .text('By signing below, you authorize the work described above at the stated price.', M, doc.y, {
          width: contentWidth
        });

      doc.moveDown(1.8);
      const sigY = doc.y;
      doc.moveTo(M, sigY).lineTo(M + 220, sigY).lineWidth(0.8).strokeColor('#aaaaaa').stroke();
      doc.font('Helvetica').fontSize(9).fillColor('#666666')
        .text('Customer Signature', M, sigY + 4, { width: 220 });

      doc.moveTo(M + 260, sigY).lineTo(M + 380, sigY).lineWidth(0.8).strokeColor('#aaaaaa').stroke();
      doc.font('Helvetica').fontSize(9).fillColor('#666666')
        .text('Date', M + 260, sigY + 4, { width: 120 });

    } else {
      // INVOICE: contract price, total, amount paid, balance due
      drawHeading(doc, 'Invoice Summary');
      drawSummaryLine(doc, 'Contract Price', formatMoney(total));
      doc.moveDown(0.3);
      drawSummaryLine(doc, 'Amount Paid',    formatMoney(paid));
      doc.moveDown(0.3);
      drawSummaryLine(doc, 'Balance Due',    formatMoney(balance), { gapAfter: 0.8 });

      doc.font('Helvetica').fontSize(11).fillColor('#222222')
        .text('Thank you for your business!', M, doc.y, { width: contentWidth });
    }

    doc.end();
  });
}

function buildInvoiceData({ job, lineItems = [], companyProfile = {}, mode = 'invoice' }) {
  const company = normalizeCompanyProfile(companyProfile, process.env);
  const workDescription = String(job.scope_of_work || company.defaultScopeOfWork || '').trim() || 'No scope of work provided.';
  const prefix = mode === 'estimate' ? 'EST' : 'INV';
  const total = Number(job.total_due || 0);
  const paid = Number(job.amount_paid || 0);
  const balance = job.balance != null ? Number(job.balance) : Math.max(0, total - paid);

  return {
    businessName: company.businessName,
    businessAddress: company.businessAddress,
    businessPhone: company.businessPhone,
    businessEmail: company.businessEmail,
    logoBase64: company.logoBase64 || null,
    date: formatDisplayDate(new Date()),
    invoiceNumber: `${prefix}-${job.id}-${Date.now()}`,
    clientName: job.client_name || '',
    clientAddress: job.client_address || '',
    clientPhone: job.client_phone || '',
    clientEmail: job.client_email || '',
    workDescription,
    lineItems: (lineItems || []).map((li) => ({
      description: String(li.description || ''),
      quantity: Number(li.quantity) || 1,
      unit_price: Number(li.unit_price) || 0,
      amount: Number(li.amount) || 0
    })),
    total,
    paid,
    balance
  };
}

module.exports = {
  buildInvoiceData,
  generateInvoicePDF
};
