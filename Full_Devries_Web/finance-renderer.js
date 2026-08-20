// ======================================================
// FINANCE DASHBOARD RENDERER
// ======================================================

const taxGroups = ['w9', 'pnl', '1099', 'insurance'];
const legacyTaxGroupKeys = { insurance: ['inference'] };
const yearSelector = document.getElementById('finance-year');
let activeYear = new Date().getFullYear();

function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '$0';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCurrencyFull(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '$0.00';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${Math.round(num * 10) / 10}%`;
}

function parseCurrencyValue(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

// ======================================================
// YEAR SELECTOR
// ======================================================
async function loadAvailableYears() {
  if (!yearSelector) return;
  try {
    const res = await fetch('/api/finance/years');
    if (!res.ok) throw new Error('Failed to fetch years');
    const years = await res.json();
    yearSelector.innerHTML = '';
    years.forEach((year) => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year;
      yearSelector.appendChild(option);
    });
    activeYear = parseInt(years[0]) || new Date().getFullYear();
    yearSelector.value = activeYear;
  } catch (err) {
    console.error('Year dropdown error:', err);
    yearSelector.innerHTML = `<option value="${activeYear}">${activeYear}</option>`;
  }
}

// ======================================================
// SALES REVENUE BY SALESPERSON
// ======================================================
async function loadSalesRevenue() {
  const grid = document.getElementById('salesRevenueGrid');
  if (!grid) return;
  try {
    const res = await fetch(`/api/finance/sales-revenue?year=${activeYear}`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    const sales = data.sales || [];
    if (!sales.length) {
      grid.innerHTML = '<div class="empty-state">No sales recorded for this period.</div>';
      return;
    }
    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total_revenue || 0), 0);
    grid.innerHTML = sales.map((s) => {
      const rev = Number(s.total_revenue || 0);
      const pct = totalRevenue > 0 ? Math.round((rev / totalRevenue) * 1000) / 10 : 0;
      const received = Number(s.total_received || 0);
      return `
        <div class="sales-card" data-sales-user="${s.id}" title="Click to filter by ${escapeHtml(s.name || s.email)}">
          <div class="sales-card-name">👤 ${escapeHtml(s.name || s.email || 'Unknown')}</div>
          <div class="sales-card-amount">${formatCurrency(rev)}</div>
          <div class="sales-card-meta">${s.job_count || 0} job${s.job_count === 1 ? '' : 's'} · ${formatCurrency(received)} received</div>
          <div class="sales-card-pct">${pct}% of total</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Sales revenue error:', err);
    grid.innerHTML = '<div class="empty-state">Unable to load sales data.</div>';
  }
}

// ======================================================
// YEARLY METRICS
// ======================================================
async function loadYearlyMetrics() {
  const container = document.getElementById('yearlyMetrics');
  if (!container) return;
  try {
    const res = await fetch(`/api/finance/summary?year=${activeYear}`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    const expected = Number(data.totalExpected || 0);
    const received = Number(data.totalReceived || 0);
    const remaining = Number(data.totalRemaining || 0);
    const clients = Number(data.totalClients || 0);
    const margin = data.avgMarginPct;
    const marginDisplay = margin != null ? formatPercent(margin) : '—';
    const marginColor = margin != null ? (margin >= 30 ? 'green' : margin >= 15 ? 'yellow' : 'red') : '';

    container.innerHTML = `
      <div class="card">
        <div class="card-label">Expected Earnings</div>
        <div class="card-value">${formatCurrency(expected)}</div>
        <div class="card-meta">Total invoiced for ${activeYear}</div>
      </div>
      <div class="card">
        <div class="card-label">Received</div>
        <div class="card-value green">${formatCurrency(received)}</div>
        <div class="card-meta">Payments collected</div>
      </div>
      <div class="card">
        <div class="card-label">Remaining</div>
        <div class="card-value ${remaining > 0 ? 'red' : 'green'}">${formatCurrency(remaining)}</div>
        <div class="card-meta">Outstanding balance</div>
      </div>
      <div class="card">
        <div class="card-label">Clients</div>
        <div class="card-value blue">${clients}</div>
        <div class="card-meta">Jobs created in ${activeYear}</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Margin</div>
        <div class="card-value ${marginColor}">${marginDisplay}</div>
        <div class="card-meta">Across all jobs with revenue</div>
      </div>
    `;
  } catch (err) {
    console.error('Yearly metrics error:', err);
    container.innerHTML = '<div class="empty-state">Unable to load metrics.</div>';
  }
}

// ======================================================
// FINANCIAL BREAKDOWN
// ======================================================
async function loadFinancialBreakdown() {
  const container = document.getElementById('financialBreakdown');
  const overheadRow = document.getElementById('overheadRow');
  if (!container) return;
  try {
    const summaryRes = await fetch(`/api/finance/summary?year=${activeYear}`);
    const costRes = await fetch(`/api/finance/cost-breakdown?year=${activeYear}`);
    if (!summaryRes.ok || !costRes.ok) throw new Error('Failed');
    const summary = await summaryRes.json();
    const costData = await costRes.json();

    const totalJobCost = Number(costData.totalJobCost || 0);
    const overhead = Number(costData.overhead || 0);
    const received = Number(summary.totalReceived || 0);
    const finalMargin = received > 0
      ? Math.round(((received - totalJobCost - overhead) / received) * 1000) / 10
      : null;

    const finalMarginDisplay = finalMargin != null ? formatPercent(finalMargin) : '—';
    const finalMarginColor = finalMargin != null ? (finalMargin >= 20 ? 'green' : finalMargin >= 0 ? 'yellow' : 'red') : '';

    container.innerHTML = `
      <div class="card">
        <div class="card-label">Total Job Cost</div>
        <div class="card-value yellow">${formatCurrency(totalJobCost)}</div>
        <div class="card-meta">Sum of all job costs for ${activeYear}</div>
      </div>
      <div class="card">
        <div class="card-label">Total Yearly Overhead</div>
        <div class="card-value">${formatCurrency(overhead)}</div>
        <div class="card-meta">Set via input below</div>
      </div>
      <div class="card">
        <div class="card-label">Final Margin</div>
        <div class="card-value ${finalMarginColor}">${finalMarginDisplay}</div>
        <div class="card-meta">Revenue − Costs − Overhead</div>
      </div>
    `;

    // Show overhead input
    if (overheadRow) {
      overheadRow.style.display = 'flex';
      const overheadInput = document.getElementById('overheadInput');
      if (overheadInput) overheadInput.value = overhead > 0 ? String(overhead) : '';
    }
  } catch (err) {
    console.error('Financial breakdown error:', err);
    container.innerHTML = '<div class="empty-state">Unable to load breakdown.</div>';
  }
}

// ======================================================
// COST BREAKDOWN BY CATEGORY
// ======================================================
async function loadCostBreakdown() {
  const container = document.getElementById('costBreakdown');
  if (!container) return;
  try {
    const res = await fetch(`/api/finance/cost-breakdown?year=${activeYear}`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    const categories = data.categories || [];

    if (!categories.length) {
      container.innerHTML = '<div class="empty-state">No expense categories recorded for this period.</div>';
      return;
    }

    const categoryIcons = {
      'Labor': '🔨', 'Contractors': '👷', 'Marketing': '📣',
      'Software': '💻', 'Operations': '⚙️', 'Taxes': '🏛️', 'Misc': '📦',
      'Material': '🪨', 'Commission': '💰'
    };

    container.innerHTML = categories.map((c) => {
      const icon = categoryIcons[c.category] || '📦';
      return `<div class="cost-pill">${icon} ${escapeHtml(c.category)}: <strong>${formatCurrency(c.total)}</strong></div>`;
    }).join('');
  } catch (err) {
    console.error('Cost breakdown error:', err);
    container.innerHTML = '<div class="empty-state">Unable to load cost breakdown.</div>';
  }
}

// ======================================================
// SAVE OVERHEAD
// ======================================================
function setupOverheadSave() {
  const btn = document.getElementById('saveOverheadBtn');
  const input = document.getElementById('overheadInput');
  if (!btn || !input) return;
  btn.addEventListener('click', async () => {
    const value = parseCurrencyValue(input.value);
    btn.textContent = 'Saving...';
    btn.disabled = true;
    try {
      const res = await fetch('/api/finance/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: activeYear, overhead: value })
      });
      if (!res.ok) throw new Error('Save failed');
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save Overhead'; btn.disabled = false; }, 1500);
      await loadFinancialBreakdown();
    } catch (err) {
      console.error('Overhead save error:', err);
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = 'Save Overhead'; btn.disabled = false; }, 2000);
    }
  });
}

// ======================================================
// FINANCIAL DOCUMENTS (shared bucket)
// ======================================================
async function loadFinancePDFs() {
  const container = document.getElementById('financePDFs');
  if (!container) return;
  container.innerHTML = '';
  try {
    const res = await fetch(`/api/pdf/list/finance-${activeYear}`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    const files = data.files || [];
    if (!files.length) {
      container.innerHTML = '<div class="empty-state">No financial documents uploaded yet.</div>';
      return;
    }
    files.forEach((file) => {
      const card = document.createElement('div');
      card.className = 'pdf-card';
      card.innerHTML = `
        <div class="pdf-icon">📄</div>
        <div class="pdf-name">${escapeHtml(file.name)}</div>
        <div>
          <button class="pdf-btn view">View</button>
          <button class="pdf-btn delete">Delete</button>
        </div>
      `;
      card.querySelector('.view').onclick = () => openPDFModal(file.url);
      card.querySelector('.delete').onclick = async () => {
        if (!confirm(`Delete ${file.name}?`)) return;
        await fetch(`/api/pdf/delete/finance-${activeYear}?file=${encodeURIComponent(file.name)}`, { method: 'DELETE' });
        loadFinancePDFs();
      };
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Finance PDFs error:', err);
    container.innerHTML = '<div class="empty-state">Unable to load documents.</div>';
  }
}

// ======================================================
// TAX DOCUMENTS
// ======================================================
async function loadTaxDocs() {
  const container = document.getElementById('taxDocsGrid');
  if (!container) return;
  container.innerHTML = '';

  const groupLabels = { w9: 'W-9', pnl: 'P&L', '1099': '1099', insurance: 'Insurance' };
  const groupIcons = { w9: '📋', pnl: '📊', '1099': '📑', insurance: '🛡️' };

  for (const group of taxGroups) {
    const keysToLoad = [group, ...(legacyTaxGroupKeys[group] || [])];
    let files = [];
    for (const key of keysToLoad) {
      try {
        const res = await fetch(`/api/pdf/list/${key}-${activeYear}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data.files)) files = files.concat(data.files.map((f) => ({ ...f, _group: key })));
      } catch {}
    }
    const seen = new Set();
    files = files.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));

    const card = document.createElement('div');
    card.className = 'pdf-card';
    card.innerHTML = `
      <div class="pdf-icon">${groupIcons[group] || '📄'}</div>
      <div class="pdf-name">${groupLabels[group] || group}</div>
      <div style="margin-bottom:8px;color:rgba(255,255,255,0.4);font-size:0.8rem;">${files.length} file${files.length === 1 ? '' : 's'}</div>
      <button class="pdf-btn view" style="margin-bottom:6px;">Upload</button>
      ${files.map((f) => `<div style="margin-top:4px;font-size:0.78rem;color:rgba(255,255,255,0.6);">${escapeHtml(f.name)} <button class="pdf-btn delete" style="font-size:0.7rem;padding:2px 6px;">×</button></div>`).join('')}
    `;
    const uploadBtn = card.querySelector('.view');
    uploadBtn.textContent = 'Upload PDF';
    uploadBtn.onclick = () => triggerUpload(group);

    card.querySelectorAll('.pdf-btn.delete').forEach((delBtn, idx) => {
      delBtn.onclick = async () => {
        if (!confirm(`Delete ${files[idx].name}?`)) return;
        await fetch(`/api/pdf/delete/${files[idx]._group || group}-${activeYear}?file=${encodeURIComponent(files[idx].name)}`, { method: 'DELETE' });
        loadTaxDocs();
      };
    });

    container.appendChild(card);
  }
}

function triggerUpload(group) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,application/pdf';
  input.multiple = true;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) { input.remove(); return; }
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      await fetch(`/api/pdf/upload/${group}-${activeYear}`, { method: 'POST', body: formData });
      loadTaxDocs();
      loadFinancePDFs();
    } catch (err) {
      console.error('Upload error:', err);
      alert('Upload failed.');
    }
    input.remove();
  });
  input.click();
}

// ======================================================
// DROP ZONE
// ======================================================
function setupDropZone() {
  const dz = document.getElementById('financeDropZone');
  if (!dz) return;
  ['dragover', 'dragleave', 'drop'].forEach((evt) =>
    dz.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); })
  );
  dz.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const original = dz.textContent;
    dz.textContent = 'Uploading...';
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      await fetch(`/api/pdf/upload/finance-${activeYear}`, { method: 'POST', body: formData });
      loadFinancePDFs();
    } catch (err) {
      console.error(err);
      alert('Upload failed.');
    } finally { dz.textContent = original; }
  });
  dz.addEventListener('click', () => triggerUpload('finance'));
}

// ======================================================
// PDF MODAL
// ======================================================
function openPDFModal(url) {
  const modal = document.getElementById('pdfModal');
  const viewer = document.getElementById('pdfViewer');
  if (!modal || !viewer) return;
  viewer.innerHTML = '';
  const embed = document.createElement('embed');
  embed.src = url;
  embed.type = 'application/pdf';
  embed.style.width = '100%';
  embed.style.height = '90vh';
  embed.style.border = 'none';
  viewer.appendChild(embed);
  modal.style.display = 'flex';
}

{
  const modal = document.getElementById('pdfModal');
  const closeBtn = document.getElementById('pdfModalClose');
  if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; document.getElementById('pdfViewer').innerHTML = ''; });
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) { modal.style.display = 'none'; document.getElementById('pdfViewer').innerHTML = ''; } });
}

// ======================================================
// UTILITY
// ======================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ======================================================
// YEAR CHANGER
// ======================================================
if (yearSelector) {
  yearSelector.addEventListener('change', (e) => {
    activeYear = parseInt(e.target.value) || new Date().getFullYear();
    refreshAll();
  });
}

// ======================================================
// REFRESH ALL
// ======================================================
async function refreshAll() {
  await Promise.all([
    loadSalesRevenue(),
    loadYearlyMetrics(),
    loadFinancialBreakdown(),
    loadCostBreakdown(),
    loadFinancePDFs(),
    loadTaxDocs()
  ]);
}

// ======================================================
// INIT
// ======================================================
(async function initFinancePage() {
  await loadAvailableYears();
  setupOverheadSave();
  setupDropZone();
  await refreshAll();
})();
