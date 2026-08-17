// ============================================================================
// main-renderer-v2.js — Client ⇄ Jobs UI
// Loaded AFTER main-renderer.js. Reuses its helpers (escapeHtml, formatMoney,
// parseMoney, applyMoneyInputBehavior, showToast, setSaveStatus, closePanel,
// refreshList, triggerFinanceUpdate, financeUndoStacks, setupNotesSection,
// printClientWorkspace, openPDFModal) and its shared state (activeId,
// activeClient, projectPanel, overlay, clientList, panelMode, currentUser...).
// ============================================================================

// ============================================================================
// CLIENT-LEVEL AGGREGATE (sum across all of a client's jobs)
// ============================================================================
function aggregateClientFinance(jobs) {
  const fin = {
    total_due: 0, paid: 0, balance_due: 0, overpayment: 0,
    expenses: 0, profit: 0, margin_pct: null, job_count: 0
  };
  (jobs || []).forEach((j) => {
    const f = j.finance || {};
    fin.total_due += Number(f.total_due || 0);
    fin.paid += Number(f.paid || 0);
    fin.balance_due += Number(f.balance_due || 0);
    fin.overpayment += Number(f.overpayment || 0);
    fin.expenses += Number(f.expenses || 0);
    fin.job_count += 1;
  });
  fin.profit = fin.paid - fin.expenses;
  fin.margin_pct = fin.paid > 0 ? Math.round((fin.profit / fin.paid) * 1000) / 10 : null;
  return fin;
}

function money(value) {
  return formatMoney(value);
}

function pctOrDash(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${Number(value)}%`;
}

// Re-render the clickable primary-tag chip (+ admin assign select) in place
// after a tag change. Listener re-attachment is unnecessary: clicks and
// changes are handled via delegation in setupClientActionButtons (v3).
function updatePrimaryTagChip() {
  const row = document.getElementById("clientPrimaryTagRow");
  if (!row) return;
  const admin = isAdmin();
  const client = activeClient;
  const chip = client && client.primary_tag_id
    ? `<button type="button" id="clientPrimaryTagChip" class="tag-chip client-primary-tag-chip" data-client-tag-id="${client.primary_tag_id}" title="Click to see all clients with this tag">${escapeHtml(client.primary_tag_name)}</button>`
    : `<span class="client-meta-value">None</span>`;
  let selectHtml = "";
  if (admin) {
    const current = client ? Number(client.primary_tag_id) : null;
    const clientTags = (allTagsCache || []).filter((t) => t.kind === 'client');
    selectHtml = `<select id="clientPrimaryTag" class="client-tag-assign" aria-label="Assign primary tag"><option value="">None</option>` +
      clientTags.map((t) => `<option value="${t.id}" ${current === Number(t.id) ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("") + `</select>`;
  }
  row.innerHTML = chip + selectHtml;
}

// ============================================================================
// OPEN CLIENT (modern panel: customer record + jobs + aggregate finance)
// ============================================================================
async function openClient(id) {
  if (!id) return;
  activeId = Number(id);
  panelMode = "client";
  try {
    const clients = await window.api.searchClients("");
    const client = clients.find((c) => c.id == id);
    if (!client) return;
    activeClient = client;

    const jobs = await window.api.listJobs(id);
    const fin = aggregateClientFinance(jobs);
    const salesNames = [...new Set((jobs || []).map((j) => j.sales_person_name).filter(Boolean))];
    const salesSummary = salesNames.length ? salesNames.join(", ") : "";

    const [fName, ...rest] = (client.name || "").split(" ");
    const lName = rest.join(" ");
    const mapsLink = client.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`
      : "";

    projectPanel.innerHTML = `
      <div class="detail-card animate-panel panel-shell" style="opacity:0; transform:translateY(-20px); transition:0.25s ease;">
        <button id="closeClientBtn" class="close-x">&times;</button>
        <header class="detail-header panel-header">
          <div class="panel-title-block">
            <div class="panel-kicker">Client Workspace</div>
            <h2>${escapeHtml(client.name || "")}</h2>
            <div class="panel-subtitle">Customer record with ${jobs.length} job${jobs.length === 1 ? "" : "s"}. Click a job to open it.</div>
          </div>
          <div class="contact-quick-links panel-contact-links">
            <span>📞 <a href="tel:${escapeHtml(client.phone || "")}">${escapeHtml(client.phone || "")}</a></span>
            <span>✉️ <a href="mailto:${escapeHtml(client.email || "")}">${escapeHtml(client.email || "")}</a></span>
          </div>
          <span id="saveStatus" class="save-status-chip">Saved</span>
        </header>

        <div class="roofing-grid panel-grid">
          <!-- Client meta strip: primary tag + address + sales summary -->
          <div class="panel-section panel-full-span client-meta-strip">
            <div class="client-meta-item">
              <span class="client-meta-label">Primary Tag</span>
              <div class="client-primary-tag-row" id="clientPrimaryTagRow">
                ${client.primary_tag_id
                  ? `<button type="button" id="clientPrimaryTagChip" class="tag-chip client-primary-tag-chip" data-client-tag-id="${client.primary_tag_id}" title="Click to see all clients with this tag">${escapeHtml(client.primary_tag_name)}</button>`
                  : `<span class="client-meta-value">None</span>`}
                ${isAdmin()
                  ? `<select id="clientPrimaryTag" class="client-tag-assign" aria-label="Assign primary tag"><option value="">Assign…</option></select>`
                  : ""}
              </div>
            </div>
            <div class="client-meta-item">
              <span class="client-meta-label">Address</span>
              <span class="client-meta-value">${escapeHtml(client.address || "—")}</span>
            </div>
            <div class="client-meta-item">
              <span class="client-meta-label">Sales</span>
              <span class="client-meta-value">${escapeHtml(salesSummary || "Unassigned")}</span>
            </div>
          </div>

          <details class="panel-collapse panel-full-span" open>
            <summary>Client Information</summary>
            <div class="roofing-grid panel-grid panel-inner-grid">
              <label>First Name</label>
              <input type="text" id="p-fname" value="${escapeHtml(fName || "")}">
              <label>Last Name</label>
              <input type="text" id="p-lname" value="${escapeHtml(lName || "")}">
              <label>Phone Number</label>
              <input type="tel" id="p-phone" value="${escapeHtml(client.phone || "")}">
              <label>Email Address</label>
              <input type="email" id="p-email" value="${escapeHtml(client.email || "")}">
              <label>Primary Address</label>
              <div class="field-stack">
                <input type="text" id="p-address" value="${escapeHtml(client.address || "")}">
                ${client.address ? `<a href="${mapsLink}" target="_blank" class="maps-link">📍 Open in Google Maps</a>` : ""}
              </div>
            </div>
          </details>

          <!-- ===== JOBS ===== -->
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Jobs</h3>
              <span class="panel-section-note">One client can have many jobs — each with its own status, scope, photos, and finances.</span>
            </div>
            <div id="clientJobsList" class="client-jobs-list"></div>
            <div class="panel-inline-row" style="margin-top:10px;">
              <input type="text" id="newJobName" placeholder="New job name (e.g. Roof replacement)" style="flex:2;">
              <select id="newJobStatus" style="flex:1; padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">
                ${STATUS_ORDER.map((s) => `<option value="${s}">${s}</option>`).join("")}
              </select>
              <button id="toggleJobDetailsBtn" type="button" class="btn-primary" style="background:rgba(255,255,255,0.14); color:white; box-shadow:none;">Details</button>
              <button id="addJobBtn" type="button" class="btn-primary" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd);">Add Job</button>
            </div>
            <div id="newJobDetails" style="display:none; margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <input type="text" id="newJobAddress" placeholder="Job address" style="padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">
              ${isAdmin() ? `<select id="newJobSales" style="padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;"><option value="">Sales person: unassigned</option></select>` : ""}
              ${isAdmin() ? `<input type="text" id="newJobTotal" placeholder="Total due ($)" inputmode="decimal" style="padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">` : ""}
              ${isAdmin() ? `<input type="text" id="newJobCost" placeholder="Job cost ($)" inputmode="decimal" style="padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">` : ""}
              <input type="text" id="newJobScope" placeholder="Scope of work" style="padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff; grid-column:1/-1;">
              <select id="newJobCopyFrom" style="padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff; grid-column:1/-1;"><option value="">Copy scope & pricing from… (optional)</option></select>
            </div>
          </div>

          <!-- ===== CLIENT FINANCE (aggregated across jobs) — ADMIN ONLY ===== -->
          ${isAdmin() ? `
          <details class="panel-collapse panel-full-span">
          <summary>Financial Overview</summary>
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <span class="panel-section-note">Aggregated across all ${jobs.length} job${jobs.length === 1 ? "" : "s"}. Open a job for payment/expense entry.</span>
            </div>
            <div class="panel-balance-row">
              <div class="panel-metric"><span>Total Due</span><strong>$${money(fin.total_due)}</strong></div>
              <div class="panel-metric"><span>Paid</span><strong>$${money(fin.paid)}</strong></div>
              <div class="panel-metric"><span>Balance Due</span><strong>$${money(fin.balance_due)}</strong></div>
              <div class="panel-metric" style="${fin.overpayment > 0 ? "background:rgba(22,163,74,0.12);" : ""}">
                <span>Overpayment/Credit</span>
                <strong style="${fin.overpayment > 0 ? "color:#16a34a;" : ""}">$${money(fin.overpayment)}</strong>
              </div>
              ${isAdmin() ? `
              <div class="panel-metric"><span>Expenses</span><strong>$${money(fin.expenses)}</strong></div>
              <div class="panel-metric"><span>Profit</span><strong>$${money(fin.profit)}</strong></div>
              <div class="panel-metric"><span>Margin %</span><strong>${pctOrDash(fin.margin_pct)}</strong></div>
              ` : ""}
            </div>
            ${fin.overpayment > 0 ? `<p style="color:#16a34a; font-size:0.85rem; margin:8px 0 0;">✔ Balance is paid in full; the excess is held as a credit (never shown as a negative balance).</p>` : ""}
          </div>
          </details>
          ` : ""}

          <details class="panel-collapse panel-full-span">
          <summary>Client Notes</summary>
          <div id="notes-section" class="notes-section panel-full-span">
            <div class="panel-section-header">
              <span class="panel-section-note">Notes about the customer. Job-specific notes live inside each job.</span>
            </div>
            <div id="notes-list" class="notes-list"></div>
            <div class="notes-actions">
              <textarea id="new-note-input" placeholder="Add a note..." rows="6"></textarea>
              <button id="add-note-btn" class="btn-primary add-note-btn" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd);">Add Note</button>
            </div>
          </div>
          </details>

          <div class="panel-actions panel-full-span">
            <button id="reviewClientBtn" class="btn-primary" style="background:rgba(255,255,255,0.14); color:white; flex:2;">Send Google Review</button>
            <button id="saveClientBtn" class="btn-primary" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd); flex:2;">Save Changes</button>
            ${isAdmin() ? `<button id="deleteClientBtn" class="btn-primary" style="background:#4a5568; flex:1;">Delete Client</button>` : ""}
            <button id="printClientBtn" class="btn-primary" style="background:rgba(255,255,255,0.14); color:white; flex:1;">Print</button>
          </div>
        </div>
      </div>
    `;

    requestAnimationFrame(() => {
      const panel = projectPanel.querySelector(".animate-panel");
      if (panel) { panel.style.opacity = 1; panel.style.transform = "translateY(0)"; }
    });

    renderClientJobs(id, jobs);
    setupNotesSection(id);
    setupClientPanelActions(id);
    setSaveStatus("saved");
    projectPanel.style.display = "block";
    if (overlay) overlay.style.display = "none";

    if (shouldUseMobileSidebarSwitch()) {
      const sidebar = document.querySelector(".sidebar");
      const mainContent = document.querySelector(".main-content");
      if (sidebar) sidebar.classList.add("mobile-hidden");
      if (mainContent) mainContent.classList.add("mobile-full");
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to open client", "error");
  }
}

// ============================================================================
// RENDER JOBS INSIDE CLIENT PANEL
// ============================================================================
let salesUsersCache = null;
async function getSalesUsers() {
  if (salesUsersCache) return salesUsersCache;
  try { salesUsersCache = await window.api.adminUsers(); } catch { salesUsersCache = []; }
  return salesUsersCache;
}

function renderClientJobs(clientId, jobs) {
  const container = document.getElementById("clientJobsList");
  if (!container) return;

  if (!jobs || jobs.length === 0) {
    container.innerHTML = `<div style="color:#888; font-size:13px;">No jobs yet. Add one below.</div>`;
    return;
  }

  container.innerHTML = jobs.map((job) => {
    const color = STATUS_COLORS[job.status] || "#007bff";
    const f = job.finance || {};
    const noteCount = Number(job.note_count || 0);
    const sales = job.sales_person_name || "";
    const created = job.created_at ? new Date(job.created_at).toLocaleDateString("en-US") : "";
    const tagChips = (job.tags || []).map((t) =>
      `<button type="button" class="job-tag" data-tag-id="${t.id}">${escapeHtml(t.name)}</button>`
    ).join("");
    const salesCell = isAdmin()
      ? `<select class="sales-assign" data-sales-job="${job.id}" title="Assign sales person" style="padding:4px 6px; border-radius:6px; border:1px solid #d0d7de; font-size:0.8rem; color:#111827; background:#fff;"><option value="">Unassigned</option></select>`
      : `<span class="sales-chip">${escapeHtml(sales || "Unassigned")}</span>`;
    return `
      <div class="job-row" data-job-id="${job.id}">
        <div class="job-row-main" data-open-job="${job.id}" style="cursor:pointer;">
          <div class="job-row-title">
            <strong>${escapeHtml(job.name || "Untitled job")}</strong>
            <span class="job-status-dot" style="background:${color};"></span><span style="color:${color}; font-size:0.8rem;">${escapeHtml(job.status || "")}</span>
          </div>
          <div class="job-row-meta">
            <span>👤 ${escapeHtml(sales || "Unassigned")}</span>
            ${created ? `<span>📅 ${created}</span>` : ""}
            ${isAdmin() ? `
              ${f.total_due ? `<span>Total <strong>$${money(f.total_due)}</strong></span>` : ""}
              ${f.balance_due > 0 ? `<span style="color:#c2410c;">Balance <strong>$${money(f.balance_due)}</strong></span>` : (f.paid > 0 ? `<span style="color:#16a34a;">Paid in full</span>` : "")}
              ${f.overpayment > 0 ? `<span style="color:#16a34a;">Credit $${money(f.overpayment)}</span>` : ""}
            ` : ""}
            ${noteCount > 0 ? `<span>📝 ${noteCount} note${noteCount === 1 ? "" : "s"}</span>` : ""}
          </div>
          ${tagChips ? `<div class="job-tags-row">${tagChips}</div>` : ""}
        </div>
        <div class="job-row-actions">
          ${isAdmin() ? salesCell : ""}
          <button type="button" class="job-open-btn" data-open-job="${job.id}">Open</button>
          <button type="button" class="job-duplicate-btn" data-dup-job="${job.id}">Duplicate</button>
        </div>
      </div>
    `;
  }).join("");

  populateSalesAssigns(jobs);
}

async function populateSalesAssigns(jobs) {
  if (!isAdmin()) return;
  try {
    const users = await getSalesUsers();
    document.querySelectorAll(".sales-assign").forEach((sel) => {
      const jobId = Number(sel.dataset.salesJob);
      const job = jobs.find((j) => Number(j.id) === jobId);
      const current = job ? Number(job.sales_user_id) : null;
      sel.innerHTML = `<option value="">Unassigned</option>` + users.map((u) =>
        `<option value="${u.id}" ${current === Number(u.id) ? "selected" : ""}>${escapeHtml(u.name || u.email)}</option>`
      ).join("");
    });
  } catch (err) {
    console.error(err);
  }
}

// ============================================================================
// CLIENT PANEL ACTIONS
// ============================================================================
async function duplicateJob(sourceJob) {
  try {
    const items = await window.api.listLineItems(sourceJob.id);
    const result = await window.api.addJob(sourceJob.client_id, {
      name: `${sourceJob.name || "Job"} (copy)`,
      status: "Pending Approval",
      address: sourceJob.address || "",
      scope_of_work: sourceJob.scope_of_work || "",
      job_cost: sourceJob.job_cost || 0,
      total_due: sourceJob.total_due || 0,
      sales_user_id: sourceJob.sales_user_id,
      line_items: (items || []).map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, amount: i.amount }))
    });
    showToast("Job duplicated — scope and pricing copied", "success");
    await openJob(result.job.id);
    refreshNotificationBadge();
    return result;
  } catch (err) {
    console.error(err);
    showToast(err.message || "Failed to duplicate job", "error");
  }
}

async function setupClientPanelActions(clientId) {
  const jobsList = document.getElementById("clientJobsList");
  const addJobBtn = document.getElementById("addJobBtn");
  const newJobName = document.getElementById("newJobName");
  const toggleDetailsBtn = document.getElementById("toggleJobDetailsBtn");
  const details = document.getElementById("newJobDetails");
  const newJobTotal = document.getElementById("newJobTotal");
  const newJobCost = document.getElementById("newJobCost");
  const newJobAddress = document.getElementById("newJobAddress");
  const newJobScope = document.getElementById("newJobScope");
  const newJobStatus = document.getElementById("newJobStatus");
  const newJobSales = document.getElementById("newJobSales");
  const newJobCopyFrom = document.getElementById("newJobCopyFrom");
  const clientPrimaryTag = document.getElementById("clientPrimaryTag");

  const jobs = await window.api.listJobs(clientId);

  // Admin-only: sales-person options + primary client tag.
  if (isAdmin()) {
    const users = await getSalesUsers();
    if (newJobSales) {
      newJobSales.innerHTML = `<option value="">Sales person: unassigned</option>` + users.map((u) => `<option value="${u.id}">${escapeHtml(u.name || u.email)}</option>`).join("");
    }
    if (clientPrimaryTag) {
      const tags = await window.api.listTags();
      allTagsCache = tags;
      const clientTags = tags.filter((t) => t.kind === 'client');
      const current = activeClient ? Number(activeClient.primary_tag_id) : null;
      clientPrimaryTag.innerHTML = `<option value="">None</option>` + clientTags.map((t) => `<option value="${t.id}" ${current === Number(t.id) ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
      // Change handled via delegation in setupClientActionButtons (v3).
    }
  }

  // Copy-from prefill (scope + pricing).
  if (newJobCopyFrom) {
    newJobCopyFrom.innerHTML = `<option value="">Copy scope & pricing from… (optional)</option>` + jobs.map((j) => `<option value="${j.id}">${escapeHtml(j.name || "Job")}</option>`).join("");
    newJobCopyFrom.addEventListener("change", () => {
      const src = jobs.find((j) => Number(j.id) === Number(newJobCopyFrom.value));
      if (!src) return;
      if (newJobScope && !newJobScope.value.trim()) newJobScope.value = src.scope_of_work || "";
      if (newJobAddress && !newJobAddress.value.trim()) newJobAddress.value = src.address || "";
      if (newJobTotal && !parseMoney(newJobTotal.value)) newJobTotal.value = src.total_due ? formatMoney(src.total_due) : "";
      if (newJobCost && !parseMoney(newJobCost.value)) newJobCost.value = src.job_cost ? formatMoney(src.job_cost) : "";
    });
  }

  if (jobsList) {
    jobsList.addEventListener("click", async (e) => {
      const tagChip = e.target.closest(".job-tag[data-tag-id]");
      if (tagChip) {
        toggleTagFilter(Number(tagChip.dataset.tagId));
        return;
      }
      const dupBtn = e.target.closest("[data-dup-job]");
      if (dupBtn) {
        const src = jobs.find((j) => Number(j.id) === Number(dupBtn.dataset.dupJob));
        if (src) await duplicateJob(src);
        return;
      }
      const openBtn = e.target.closest("[data-open-job]");
      if (openBtn) openJob(Number(openBtn.dataset.openJob));
    });
    jobsList.addEventListener("change", async (e) => {
      const sel = e.target.closest(".sales-assign");
      if (!sel) return;
      const jobId = Number(sel.dataset.salesJob);
      try {
        await window.api.setJobSalesUser(jobId, sel.value || null);
        showToast("Sales person assigned", "success");
        const refreshed = await window.api.listJobs(clientId);
        renderClientJobs(clientId, refreshed);
        await refreshList();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to assign sales person", "error");
      }
    });
  }

  if (toggleDetailsBtn && details) {
    toggleDetailsBtn.addEventListener("click", () => {
      const hidden = details.style.display === "none";
      details.style.display = hidden ? "grid" : "none";
    });
  }
  if (newJobTotal) applyMoneyInputBehavior(newJobTotal);
  if (newJobCost) applyMoneyInputBehavior(newJobCost);

  if (addJobBtn && newJobName) {
    addJobBtn.addEventListener("click", async () => {
      const name = newJobName.value.trim();
      if (!name) { showToast("Job name is required", "error"); return; }
      addJobBtn.disabled = true;
      addJobBtn.textContent = "Adding...";
      try {
        const copyId = newJobCopyFrom ? Number(newJobCopyFrom.value) : 0;
        let lineItems = [];
        if (copyId) {
          lineItems = (await window.api.listLineItems(copyId)).map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, amount: i.amount }));
        }
        const payload = {
          name,
          status: newJobStatus ? newJobStatus.value : "Pending Approval",
          address: newJobAddress ? newJobAddress.value.trim() : "",
          total_due: newJobTotal ? parseMoney(newJobTotal.value) : 0,
          job_cost: newJobCost ? parseMoney(newJobCost.value) : 0,
          scope_of_work: newJobScope ? newJobScope.value.trim() : "",
          line_items: lineItems
        };
        if (isAdmin() && newJobSales && newJobSales.value) payload.sales_user_id = Number(newJobSales.value);
        await window.api.addJob(clientId, payload);
        showToast("Job added", "success");
        newJobName.value = "";
        if (newJobAddress) newJobAddress.value = "";
        if (newJobTotal) newJobTotal.value = "";
        if (newJobCost) newJobCost.value = "";
        if (newJobScope) newJobScope.value = "";
        refreshNotificationBadge();
        const refreshed = await window.api.listJobs(clientId);
        renderClientJobs(clientId, refreshed);
        await refreshList();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to add job", "error");
      } finally {
        addJobBtn.disabled = false;
        addJobBtn.textContent = "Add Job";
      }
    });
  }
}

// ============================================================================
// OPEN JOB (job-level workspace)
// ============================================================================
async function openJob(jobId, opts = {}) {
  if (!jobId) return;
  activeJobId = Number(jobId);
  try {
    const data = await window.api.getJob(jobId);
    const job = data.job;
    if (!job) return;
    activeId = Number(job.client_id);
    panelMode = "job";

    const f = job.finance || {};
    const locked = !f.finance_enabled;

    projectPanel.innerHTML = `
      <div class="detail-card animate-panel panel-shell" style="opacity:0; transform:translateY(-20px); transition:0.25s ease;">
        <button id="closeJobBtn" class="close-x">&times;</button>
        <header class="detail-header panel-header">
          <div class="panel-title-block">
            <div class="panel-kicker">Job Workspace</div>
            <h2><input id="jobNameInput" value="${escapeHtml(job.name || "Untitled job")}" style="background:transparent; border:none; border-bottom:1px solid rgba(255,255,255,0.3); color:#fff; font-size:1.3rem; font-weight:800; width:100%; padding:2px 0;"></h2>
            <div class="panel-subtitle">
              <button id="backToClientBtn" class="link-btn" style="background:none; border:none; color:#7fd9ff; cursor:pointer; padding:0; font-size:0.85rem;">← Back to ${escapeHtml(job.client_name || "Client")}</button>
            </div>
          </div>
          <div class="contact-quick-links panel-contact-links">
            <span>📞 <a href="tel:${escapeHtml(job.client_phone || "")}">${escapeHtml(job.client_phone || "")}</a></span>
            <span>✉️ <a href="mailto:${escapeHtml(job.client_email || "")}">${escapeHtml(job.client_email || "")}</a></span>
          </div>
          <span id="saveStatus" class="save-status-chip">Saved</span>
        </header>

        <div class="roofing-grid panel-grid">
          <div class="panel-section panel-full-span client-meta-strip">
            <div class="client-meta-item">
              <span class="client-meta-label">Client</span>
              <span class="client-meta-value">${escapeHtml(job.client_name || "")}</span>
            </div>
            <div class="client-meta-item">
              <span class="client-meta-label">Sales Person</span>
              ${isAdmin()
                ? `<select id="jobSalesSelect" style="padding:6px 8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;"><option value="">Unassigned</option></select>`
                : `<span class="client-meta-value">${escapeHtml(job.sales_person_name || "Unassigned")}</span>`}
            </div>
            <div class="client-meta-item">
              <span class="client-meta-label">Created</span>
              <span class="client-meta-value">${job.created_at ? new Date(job.created_at).toLocaleDateString("en-US") : "—"}</span>
            </div>
          </div>

          <div class="panel-full-span">
            <label>Job Status</label>
            <select id="jobStatusSelect" style="width:100%; padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">
              ${STATUS_ORDER.map((s) => `<option value="${s}" ${job.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
            ${locked
              ? `<p style="color:#e9c46a; font-size:0.85rem; margin:6px 0 0;">🔒 Finance tracking is locked. Set the status to <strong>Approved</strong> to record payments and expenses.</p>`
              : `<p style="color:#16a34a; font-size:0.85rem; margin:6px 0 0;">✔ Approved — finance tracking enabled.</p>`}
          </div>

          <label>Job Address</label>
          <div class="field-stack">
            <input type="text" id="jobAddressInput" value="${escapeHtml(job.address || "")}">
            ${job.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}" target="_blank" class="maps-link">📍 Open in Google Maps</a>` : ""}
          </div>

          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Scope of Work</h3>
              <span class="panel-section-note">Pulled onto invoices and estimates. Independent from notes.</span>
            </div>
            <textarea id="jobScopeInput" rows="5" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #d0d7de; font-size:0.95rem; resize:vertical; box-sizing:border-box; font-family:inherit; color:#111827; background:#fff;">${escapeHtml(job.scope_of_work || "")}</textarea>
          </div>

          <!-- ===== ESTIMATE / INVOICE (line items) ===== -->
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Estimate / Invoice</h3>
              <span class="panel-section-note">Line items and pricing for this job. Saved independently per job.</span>
            </div>
            <div id="jobLineItems" class="panel-list"></div>
            <div class="panel-inline-row" style="margin-top:8px;">
              <input id="liDesc" type="text" placeholder="Description" style="flex:2; padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">
              <input id="liQty" type="text" inputmode="decimal" placeholder="Qty" style="width:64px; padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">
              <input id="liPrice" type="text" inputmode="decimal" placeholder="Unit $" style="width:96px; padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">
              <button id="addLineItemBtn" type="button" class="btn-primary" style="background:rgba(255,255,255,0.14); color:white; box-shadow:none;">Add</button>
            </div>
            <div class="panel-inline-row" style="margin-top:8px;">
              <button id="saveLineItemsBtn" type="button" class="btn-primary" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd);">Save Line Items</button>
              <button id="jobEstimateBtn" type="button" class="btn-primary" style="background:linear-gradient(135deg,#0f9b58,#27c97a);">Download Estimate</button>
              <button id="jobInvoiceBtn" type="button" class="btn-primary" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd);">Download Invoice</button>
            </div>
          </div>

          <!-- ===== TAGS ===== -->
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Tags</h3>
              <span class="panel-section-note">Click a tag to see all jobs with it.</span>
            </div>
            <div id="jobTagsList" class="job-tags-row"></div>
            <div class="panel-inline-row" style="margin-top:8px;">
              <select id="jobTagSelect" style="flex:2; padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">
                <option value="">Select a tag…</option>
              </select>
              <button id="addJobTagBtn" class="btn-primary" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd);">Add Tag</button>
              ${isAdmin() ? `<button id="manageTagsBtn" class="btn-primary" style="background:rgba(255,255,255,0.14); color:white; box-shadow:none;">Manage Tags</button>` : ""}
            </div>
          </div>

          <!-- ===== PHOTOS ===== -->
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Job Photos &amp; Files</h3>
              <span class="panel-section-note">Scoped to this job only.</span>
            </div>
            <div id="jobPhotoDrop" class="drop-zone">📷 Drop photos/PDFs here</div>
            <div class="panel-inline-row" style="margin-top:8px;">
              <button id="jobPhotoUploadBtn" type="button" class="panel-secondary-btn" style="background:rgba(255,255,255,0.14); color:white; border:none; padding:8px; border-radius:6px; cursor:pointer;">Upload Photos / PDFs</button>
              <input type="file" id="jobPhotoFileInput" accept="image/*,.pdf,application/pdf" multiple hidden />
            </div>
            <div id="jobPhotosList" class="job-photos-grid"></div>
          </div>

          <!-- ===== FINANCE — ADMIN ONLY ===== -->
          ${isAdmin() ? `
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Job Finance</h3>
              <span class="panel-section-note">Amount Due − Payments = Balance Due · Revenue − Expenses = Profit · Profit ÷ Revenue = Margin</span>
            </div>
            <div class="panel-inline-row">
              <input type="text" id="jobTotalInput" placeholder="Amount Due" inputmode="decimal" class="panel-money-input" value="${f.total_due ? formatMoney(f.total_due) : ""}">
              <button id="saveJobTotalBtn" class="btn-primary" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd);">Save</button>
            </div>
            <div class="panel-balance-row">
              <div class="panel-metric"><span>Amount Due</span><strong id="jobDueDisplay">$${money(f.total_due)}</strong></div>
              <div class="panel-metric"><span>Paid</span><strong id="jobPaidDisplay">$${money(f.paid)}</strong></div>
              <div class="panel-metric"><span>Balance Due</span><strong id="jobBalanceDisplay" style="${f.balance_due > 0 ? "color:#c2410c;" : "color:#16a34a;"}">$${money(f.balance_due)}</strong></div>
              <div class="panel-metric" style="${f.overpayment > 0 ? "background:rgba(22,163,74,0.12);" : ""}">
                <span>Overpayment/Credit</span>
                <strong id="jobOverpaymentDisplay" style="${f.overpayment > 0 ? "color:#16a34a;" : ""}">$${money(f.overpayment)}</strong>
              </div>
              <div class="panel-metric"><span>Expenses</span><strong id="jobExpensesDisplay">$${money(f.expenses)}</strong></div>
              <div class="panel-metric"><span>Profit</span><strong id="jobProfitDisplay">$${money(f.profit)}</strong></div>
              <div class="panel-metric"><span>Margin %</span><strong id="jobMarginDisplay">${pctOrDash(f.margin_pct)}</strong></div>
            </div>

            <div class="panel-inline-row" style="margin-top:10px;">
              <input type="text" id="jobPaymentInput" placeholder="Add Payment" inputmode="decimal" class="panel-money-input" ${locked ? "disabled style='opacity:0.5;'" : ""}>
              <button id="addPaymentJobBtn" class="btn-primary" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd);" ${locked ? "disabled" : ""}>Add Payment</button>
              <button id="undoFinanceJobBtn" class="btn-primary" style="background:rgba(255,255,255,0.14); color:white;">Undo</button>
              <button id="adminAdjustBtn" class="btn-primary" style="background:rgba(170,27,27,0.85); color:white;">Adjust (Admin)</button>
            </div>

            <div class="panel-inline-row" style="margin-top:8px;">
              <select id="expCategorySelect" style="flex:1; padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;" ${locked ? "disabled" : ""}>
                ${["Labor", "Marketing", "Software", "Contractors", "Operations", "Taxes", "Misc"].map((c) => `<option value="${c}">${c}</option>`).join("")}
              </select>
              <input type="text" id="expAmountInput" placeholder="Expense amount ($)" inputmode="decimal" class="panel-money-input" ${locked ? "disabled style='opacity:0.5;'" : ""}>
              <input type="text" id="expNotesInput" placeholder="Expense note" style="flex:2; padding:8px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;" ${locked ? "disabled" : ""}>
              <button id="addExpenseJobBtn" class="btn-primary" style="background:rgba(255,255,255,0.14); color:white; box-shadow:none;" ${locked ? "disabled" : ""}>Add Expense</button>
            </div>

            <div id="jobExpensesList" class="panel-list" style="margin-top:10px;"></div>
            <div id="jobPaymentsList" class="panel-list" style="margin-top:10px;"></div>
            <div id="jobAdjustmentsList" class="panel-list" style="margin-top:10px;"></div>
          </div>
          ` : ""}

          <!-- ===== JOB NOTES ===== -->
          <div id="job-notes-section" class="notes-section panel-full-span">
            <div class="panel-section-header">
              <h3>Job Notes</h3>
              <span class="panel-section-note">Notes specific to this job.</span>
            </div>
            <div id="job-notes-list" class="notes-list"></div>
            <div class="notes-actions">
              <textarea id="job-new-note-input" placeholder="Add a note..." rows="4"></textarea>
              <button id="job-add-note-btn" class="btn-primary add-note-btn" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd);">Add Note</button>
            </div>
          </div>

          <div class="panel-actions panel-full-span">
            <button id="saveJobBtn" class="btn-primary" style="background:linear-gradient(135deg,#2f80ed,#4f8dfd); flex:2;">Save Job</button>
            <button id="printJobBtn" class="btn-primary" style="background:rgba(255,255,255,0.14); color:white; flex:1;">Print</button>
            <button id="deleteJobBtn" class="btn-primary" style="background:#4a5568; flex:1;">Delete Job</button>
          </div>
        </div>
      </div>
    `;

    requestAnimationFrame(() => {
      const panel = projectPanel.querySelector(".animate-panel");
      if (panel) { panel.style.opacity = 1; panel.style.transform = "translateY(0)"; }
    });

    projectPanel.style.display = "block";
    if (overlay) overlay.style.display = "none";
    if (shouldUseMobileSidebarSwitch()) {
      const sidebar = document.querySelector(".sidebar");
      const mainContent = document.querySelector(".main-content");
      if (sidebar) sidebar.classList.add("mobile-hidden");
      if (mainContent) mainContent.classList.add("mobile-full");
    }

    applyMoneyInputBehavior(document.getElementById("jobTotalInput"));
    applyMoneyInputBehavior(document.getElementById("jobPaymentInput"));
    applyMoneyInputBehavior(document.getElementById("expAmountInput"));
    setupJobTags(job);
    setupJobLineItems(job);
    setupJobSalesSelect(job);
    setupJobPhotos(job.id);
    setupJobNotesSection(job.id);
    setupJobFinance(job);
    setupJobPanelActions(job);
  } catch (err) {
    console.error(err);
    showToast("Failed to open job", "error");
  }
}

// ============================================================================
// JOB TAGS
// ============================================================================
async function setupJobTags(job) {
  const list = document.getElementById("jobTagsList");
  const select = document.getElementById("jobTagSelect");
  const addBtn = document.getElementById("addJobTagBtn");
  if (!list || !select || !addBtn) return;

  const renderTags = () => {
    list.innerHTML = (job.tags || []).map((t) =>
      `<span class="job-tag" data-tag-id="${t.id}">${escapeHtml(t.name)} <span class="job-tag-remove" data-remove-tag="${t.id}" title="Remove tag" style="cursor:pointer; opacity:0.7;">×</span></span>`
    ).join("") || `<span style="color:#888; font-size:13px;">No tags yet.</span>`;
  };
  renderTags();

  try {
    const data = await window.api.listTags();
    allTagsCache = data;
    const attached = new Set((job.tags || []).map((t) => Number(t.id)));
    select.innerHTML = `<option value="">Select a tag…</option>` +
      data.filter((t) => !attached.has(Number(t.id))).map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  } catch (err) {
    console.error(err);
  }

  addBtn.addEventListener("click", async () => {
    const tagId = select.value;
    if (!tagId) { showToast("Choose a tag to add", "info"); return; }
    try {
      const ids = [...(job.tags || []).map((t) => Number(t.id)), Number(tagId)];
      const result = await window.api.setJobTags(job.id, ids);
      job.tags = result.tags || [];
      setupJobTags(job);
      refreshTagFilterBar();
      showToast("Tag added", "success");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to add tag", "error");
    }
  });

  list.addEventListener("click", async (e) => {
    const remove = e.target.closest("[data-remove-tag]");
    if (remove) {
      const removeId = Number(remove.dataset.removeTag);
      try {
        const ids = (job.tags || []).map((t) => Number(t.id)).filter((id) => id !== removeId);
        const result = await window.api.setJobTags(job.id, ids);
        job.tags = result.tags || [];
        setupJobTags(job);
        refreshTagFilterBar();
        showToast("Tag removed", "success");
      } catch (err) {
        console.error(err);
        showToast("Failed to remove tag", "error");
      }
      return;
    }
    const chip = e.target.closest("[data-tag-id]");
    if (chip && !e.target.closest("[data-remove-tag]")) {
      // Clicking a tag filters all jobs by it.
      await toggleTagFilter(Number(chip.dataset.tagId));
    }
  });
}

// ============================================================================
// JOB PHOTOS / FILES
// ============================================================================
async function setupJobPhotos(jobId) {
  const list = document.getElementById("jobPhotosList");
  const drop = document.getElementById("jobPhotoDrop");
  const uploadBtn = document.getElementById("jobPhotoUploadBtn");
  const fileInput = document.getElementById("jobPhotoFileInput");
  if (!list || !drop || !uploadBtn || !fileInput) return;

  const isImage = (file) => /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.name || "") || /^image\//i.test(file.ext || "");

  async function loadPhotos() {
    list.innerHTML = "";
    try {
      const files = await window.api.listJobPhotos(jobId);
      if (!files.length) {
        list.innerHTML = `<div style="color:#888; font-size:13px;">No photos or files yet.</div>`;
        return;
      }
      files.forEach((file) => {
        const card = document.createElement("div");
        card.className = "job-photo-card";
        if (isImage(file)) {
          const img = document.createElement("img");
          img.src = file.url;
          img.alt = file.name;
          img.loading = "lazy";
          img.onclick = () => { if (file.url) window.open(file.url, "_blank"); };
          card.appendChild(img);
        } else {
          const link = document.createElement("a");
          link.href = file.url || "#";
          link.target = "_blank";
          link.textContent = `📄 ${file.name}`;
          link.style.display = "block";
          link.style.padding = "12px 8px";
          link.style.wordBreak = "break-all";
          card.appendChild(link);
        }
        const del = document.createElement("button");
        del.textContent = "Delete";
        del.className = "job-photo-delete";
        del.onclick = async () => {
          if (!confirm(`Delete "${file.name}"?`)) return;
          try {
            await window.api.deleteJobFile(jobId, file.name);
            loadPhotos();
            showToast("File deleted", "success");
          } catch (err) {
            console.error(err);
            showToast("Failed to delete file", "error");
          }
        };
        card.appendChild(del);
        list.appendChild(card);
      });
    } catch (err) {
      console.error(err);
      list.innerHTML = `<div style="color:#888; font-size:13px;">Unable to load files.</div>`;
    }
  }

  async function uploadFiles(files) {
    if (!files || !files.length) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading...";
    try {
      await window.api.uploadJobFiles(files, jobId);
      showToast("Upload complete", "success");
      await loadPhotos();
      refreshNotificationBadge();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Upload failed", "error");
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Upload Photos / PDFs";
      fileInput.value = "";
    }
  }

  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => uploadFiles(Array.from(e.target.files)));

  ["dragover", "dragleave", "drop"].forEach((evt) =>
    drop.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); })
  );
  drop.addEventListener("drop", (e) => uploadFiles(Array.from(e.dataTransfer.files || [])));

  loadPhotos();
}

// ============================================================================
// JOB NOTES (job-scoped)
// ============================================================================
async function setupJobNotesSection(jobId) {
  const list = document.getElementById("job-notes-list");
  const input = document.getElementById("job-new-note-input");
  const addBtn = document.getElementById("job-add-note-btn");
  if (!list || !input || !addBtn) return;

  async function loadNotes() {
    list.innerHTML = "";
    try {
      const data = await window.api.listJobNotes(jobId);
      if (!data.notes || data.notes.length === 0) {
        list.innerHTML = `<div style="color:#888; font-size:13px;">No notes yet.</div>`;
        return;
      }
      data.notes.forEach((note) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.background = "#f5f5f5";
        row.style.padding = "6px 10px";
        row.style.borderRadius = "6px";
        row.style.marginBottom = "6px";

        const content = document.createElement("div");
        content.innerText = note.content || "";
        content.style.flex = "1";
        content.style.marginRight = "6px";
        content.style.color = "#000";
        content.style.whiteSpace = "pre-wrap";
        content.style.wordBreak = "break-word";

        const editBtn = document.createElement("button");
        editBtn.innerText = "Edit";
        editBtn.style.cssText = "background:linear-gradient(135deg,#2f80ed,#4f8dfd); color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;";
        const delBtn = document.createElement("button");
        delBtn.innerText = "Delete";
        delBtn.style.cssText = "background:#4a5568; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-left:6px;";

        editBtn.onclick = async () => {
          const ta = document.createElement("textarea");
          ta.value = note.content || "";
          ta.rows = 3;
          ta.style.cssText = "flex:1; padding:10px 12px; border-radius:6px; border:1px solid rgba(148,163,184,0.6); color:#111827; background:#fff; font-family:inherit; resize:vertical;";
          const save = document.createElement("button");
          save.innerText = "Save";
          save.style.cssText = "background:linear-gradient(135deg,#2f80ed,#4f8dfd); color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-left:6px;";
          const cancel = document.createElement("button");
          cancel.innerText = "Cancel";
          cancel.style.cssText = "background:rgba(255,255,255,0.14); color:#1a202c; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-left:6px;";
          row.replaceChild(ta, content);
          row.insertBefore(save, editBtn);
          row.insertBefore(cancel, editBtn);
          editBtn.style.display = "none";
          save.onclick = async () => {
            const trimmed = ta.value.trim();
            if (!trimmed) { showToast("Note cannot be empty", "error"); return; }
            try { await window.api.updateJobNote(jobId, note.id, trimmed); loadNotes(); } catch (err) { console.error(err); showToast("Failed to update note", "error"); }
          };
          cancel.onclick = () => loadNotes();
          ta.focus();
        };

        delBtn.onclick = async () => {
          if (!confirm("Delete this note?")) return;
          try { await window.api.deleteJobNote(jobId, note.id); loadNotes(); } catch (err) { console.error(err); showToast("Failed to delete note", "error"); }
        };

        row.appendChild(content);
        row.appendChild(editBtn);
        row.appendChild(delBtn);
        list.appendChild(row);
      });
    } catch (err) {
      console.error(err);
    }
  }

  addBtn.addEventListener("click", async () => {
    const content = input.value.trim();
    if (!content) { showToast("Cannot add empty note", "error"); return; }
    try {
      await window.api.addJobNote(jobId, content);
      input.value = "";
      loadNotes();
    } catch (err) {
      console.error(err);
      showToast("Failed to add note", "error");
    }
  });

  loadNotes();
}

// ============================================================================
// JOB FINANCE (payments, expenses, undo, overpayment display)
// ============================================================================
async function setupJobFinance(job) {
  const jobId = job.id;
  const f = job.finance || {};
  const locked = !f.finance_enabled;

  const dueDisplay = document.getElementById("jobDueDisplay");
  const paidDisplay = document.getElementById("jobPaidDisplay");
  const balanceDisplay = document.getElementById("jobBalanceDisplay");
  const overpaymentDisplay = document.getElementById("jobOverpaymentDisplay");
  const expensesDisplay = document.getElementById("jobExpensesDisplay");
  const profitDisplay = document.getElementById("jobProfitDisplay");
  const marginDisplay = document.getElementById("jobMarginDisplay");

  function applyFinance(finance) {
    if (!finance) return;
    if (dueDisplay) dueDisplay.textContent = "$" + money(finance.total_due);
    if (paidDisplay) paidDisplay.textContent = "$" + money(finance.paid);
    if (balanceDisplay) {
      balanceDisplay.textContent = "$" + money(finance.balance_due);
      balanceDisplay.style.color = finance.balance_due > 0 ? "#c2410c" : "#16a34a";
    }
    if (overpaymentDisplay) {
      overpaymentDisplay.textContent = "$" + money(finance.overpayment);
      overpaymentDisplay.style.color = finance.overpayment > 0 ? "#16a34a" : "";
    }
    if (expensesDisplay) expensesDisplay.textContent = "$" + money(finance.expenses);
    if (profitDisplay) profitDisplay.textContent = "$" + money(finance.profit);
    if (marginDisplay) marginDisplay.textContent = pctOrDash(finance.margin_pct);
  }

  const saveTotalBtn = document.getElementById("saveJobTotalBtn");
  const totalInput = document.getElementById("jobTotalInput");
  if (saveTotalBtn && totalInput) {
    saveTotalBtn.addEventListener("click", async () => {
      const newTotal = parseMoney(totalInput.value);
      try {
        pushFinanceUndoState(jobId, { total_due: f.total_due, amount_paid: f.paid, balance: f.balance_due });
        const result = await window.api.jobTotal(jobId, newTotal);
        applyFinance(result.job.finance);
        refreshList();
        triggerFinanceUpdate();
        showToast("Total updated", "success");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to update total", "error");
      }
    });
  }

  const paymentInput = document.getElementById("jobPaymentInput");
  const addPaymentBtn = document.getElementById("addPaymentJobBtn");
  if (addPaymentBtn && paymentInput) {
    addPaymentBtn.addEventListener("click", async () => {
      const payment = parseMoney(paymentInput.value);
      if (payment <= 0) { showToast("Enter a valid payment", "error"); return; }
      try {
        pushFinanceUndoState(jobId, { total_due: f.total_due, amount_paid: f.paid, balance: f.balance_due });
        const result = await window.api.jobPayment(jobId, payment);
        applyFinance(result.job.finance);
        paymentInput.value = "";
        refreshList();
        triggerFinanceUpdate();
        refreshNotificationBadge();
        loadJobExpenses(jobId);
        loadJobPayments(jobId);
        showToast("Payment added", "success");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to add payment", "error");
      }
    });
  }

  const undoBtn = document.getElementById("undoFinanceJobBtn");
  if (undoBtn) {
    undoBtn.addEventListener("click", async () => {
      const last = peekFinanceUndoState(jobId);
      if (!last) { showToast("Nothing to undo", "info"); return; }
      if (!confirm("Undo the last payment/total change?")) return;
      popFinanceUndoState(jobId);
      try {
        const result = await window.api.jobRestoreFinanceState(jobId, {
          total_due: last.total_due,
          amount_paid: last.amount_paid
        });
        applyFinance(result.job.finance);
        refreshList();
        triggerFinanceUpdate();
        loadJobExpenses(jobId);
        loadJobPayments(jobId);
        showToast("Undo complete", "success");
      } catch (err) {
        console.error(err);
        showToast("Undo failed", "error");
      }
    });
  }

  const addExpenseBtn = document.getElementById("addExpenseJobBtn");
  const expCategory = document.getElementById("expCategorySelect");
  const expAmount = document.getElementById("expAmountInput");
  const expNotes = document.getElementById("expNotesInput");
  if (addExpenseBtn && expCategory && expAmount) {
    addExpenseBtn.addEventListener("click", async () => {
      const amount = parseMoney(expAmount.value);
      if (amount <= 0) { showToast("Enter a valid expense amount", "error"); return; }
      try {
        await window.api.addJobExpense(jobId, {
          category: expCategory.value || "Misc",
          amount,
          notes: expNotes ? expNotes.value.trim() : ""
        });
        expAmount.value = "";
        if (expNotes) expNotes.value = "";
        const result = await window.api.getJob(jobId);
        applyFinance(result.job.finance);
        refreshList();
        triggerFinanceUpdate();
        refreshNotificationBadge();
        loadJobExpenses(jobId);
        showToast("Expense recorded", "success");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to record expense", "error");
      }
    });
  }

  loadJobPayments(jobId);
  if (isAdmin()) {
    loadJobExpenses(jobId);
    loadJobAdjustments(jobId);
  }
}

// ============================================================================
// JOB EXPENSES LIST
// ============================================================================
async function loadJobExpenses(jobId) {
  const container = document.getElementById("jobExpensesList");
  if (!container) return;
  container.innerHTML = "";
  try {
    const expenses = await window.api.listJobExpenses(jobId);
    if (!expenses.length) {
      container.innerHTML = `<div style="color:#888; font-size:13px;">No expenses recorded.</div>`;
      return;
    }
    container.innerHTML = `<div class="list-section-label">Expenses</div>` + expenses.map((e) => {
      const date = e.expense_date ? new Date(e.expense_date).toLocaleDateString("en-US") : "";
      return `
        <div class="job-finance-row">
          <span>${escapeHtml(e.category || "Misc")}${e.notes ? ` — ${escapeHtml(e.notes)}` : ""} ${date ? `<small>(${date})</small>` : ""}</span>
          <span style="font-weight:700;">$${money(e.amount)}</span>
          <button class="job-finance-delete" data-del-expense="${e.id}" style="background:none; border:none; color:#e5484d; cursor:pointer; font-size:0.9rem;">×</button>
        </div>`;
    }).join("");
    container.querySelectorAll("[data-del-expense]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this expense?")) return;
        try {
          await window.api.deleteJobExpense(jobId, Number(btn.dataset.delExpense));
          loadJobExpenses(jobId);
          const result = await window.api.getJob(jobId);
          const f = result.job.finance;
          const el = document.getElementById("jobExpensesDisplay");
          if (el) el.textContent = "$" + money(f.expenses);
          const profitEl = document.getElementById("jobProfitDisplay");
          if (profitEl) profitEl.textContent = "$" + money(f.profit);
          const marginEl = document.getElementById("jobMarginDisplay");
          if (marginEl) marginEl.textContent = pctOrDash(f.margin_pct);
          refreshList();
          triggerFinanceUpdate();
        } catch (err) {
          console.error(err);
          showToast("Failed to delete expense", "error");
        }
      });
    });
  } catch (err) {
    console.error(err);
  }
}

// ============================================================================
// JOB PAYMENTS HISTORY
// ============================================================================
async function loadJobPayments(jobId) {
  const container = document.getElementById("jobPaymentsList");
  if (!container) return;
  container.innerHTML = "";
  try {
    const payments = await window.api.listJobPayments(jobId);
    if (!payments.length) {
      container.innerHTML = `<div style="color:#888; font-size:13px;">No payments recorded.</div>`;
      return;
    }
    container.innerHTML = `<div class="list-section-label">Payments (history)</div>` + payments.map((p) => {
      const date = p.payment_date ? new Date(p.payment_date).toLocaleDateString("en-US") : "";
      const positive = Number(p.amount) >= 0;
      return `
        <div class="job-finance-row">
          <span>Payment ${date ? `(${date})` : ""}</span>
          <span style="font-weight:700; color:${positive ? "#16a34a" : "#c2410c"};">${positive ? "+" : ""}$${money(p.amount)}</span>
        </div>`;
    }).join("");
  } catch (err) {
    console.error(err);
  }
}

// ============================================================================
// ADMIN — JOB ADJUSTMENTS (audit trail)
// ============================================================================
async function loadJobAdjustments(jobId) {
  const container = document.getElementById("jobAdjustmentsList");
  if (!container) return;
  container.innerHTML = "";
  try {
    const adjustments = await window.api.adminAdjustments(jobId);
    if (!adjustments.length) {
      container.innerHTML = `<div style="color:#888; font-size:13px;">No finance adjustments.</div>`;
      return;
    }
    container.innerHTML = `<div class="list-section-label">Admin Adjustments (audit trail)</div>` + adjustments.map((a) => {
      const date = a.created_at ? new Date(a.created_at).toLocaleString("en-US") : "";
      return `
        <div class="job-finance-row" style="flex-direction:column; align-items:flex-start; gap:2px;">
          <span><strong>${escapeHtml(a.record_type || "")}</strong> ${escapeHtml(a.field_name || "")}: $${money(a.old_value)} → $${money(a.new_value)} <small>(${date})</small></span>
          <span style="font-size:0.8rem; color:#53657d;">by ${escapeHtml(a.adjusted_by_name || a.adjusted_by || "")}${a.reason ? ` — ${escapeHtml(a.reason)}` : ""}</span>
        </div>`;
    }).join("");
  } catch (err) {
    console.error(err);
  }
}

function openAdjustmentModal(job) {
  const overlayEl = document.createElement("div");
  overlayEl.className = "adjust-modal-overlay";
  overlayEl.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:10001; display:flex; align-items:center; justify-content:center; padding:18px;";
  overlayEl.innerHTML = `
    <div style="position:relative; width:min(560px,100%); max-height:90vh; overflow:auto; border-radius:14px; background:#fff; box-shadow:0 24px 60px rgba(0,0,0,0.2); color:#1e3c72; padding:24px;">
      <button class="adjust-modal-close" style="position:absolute; top:12px; right:14px; border:none; background:transparent; font-size:1.5rem; cursor:pointer; color:#666;">&times;</button>
      <h2 style="margin:0 0 6px; font-size:1.3rem; color:#1e3c72;">Finance Adjustment (Admin)</h2>
      <p style="margin:0 0 14px; color:#53657d; font-size:0.9rem;">Records who, what, and why. Normal users cannot access this.</p>
      <label style="display:block; font-size:0.88rem; font-weight:600; margin-bottom:4px; color:#53657d;">Record type</label>
      <select id="adjType" style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; border:1px solid #d0d7de; font-size:0.95rem; color:#111827; background:#fff; margin-bottom:10px;">
        <option value="total_due">Total due (amount due)</option>
        <option value="job_cost">Job cost</option>
        <option value="payment">Payment amount</option>
        <option value="expense">Expense amount</option>
      </select>
      <label id="adjRecordLabel" style="display:none; font-size:0.88rem; font-weight:600; margin-bottom:4px; color:#53657d;">Record</label>
      <select id="adjRecord" style="display:none; width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; border:1px solid #d0d7de; font-size:0.95rem; color:#111827; background:#fff; margin-bottom:10px;"></select>
      <label style="display:block; font-size:0.88rem; font-weight:600; margin-bottom:4px; color:#53657d;">Current value</label>
      <div id="adjCurrentValue" style="padding:10px 12px; border-radius:8px; background:#f1f5fa; font-weight:700; margin-bottom:10px;">$0.00</div>
      <label style="display:block; font-size:0.88rem; font-weight:600; margin-bottom:4px; color:#53657d;">New value</label>
      <input id="adjNewValue" type="text" inputmode="decimal" placeholder="0.00" style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; border:1px solid #d0d7de; font-size:0.95rem; color:#111827; background:#fff; margin-bottom:10px;">
      <label style="display:block; font-size:0.88rem; font-weight:600; margin-bottom:4px; color:#53657d;">Reason (required)</label>
      <textarea id="adjReason" rows="3" placeholder="Why is this being corrected?" style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; border:1px solid #d0d7de; font-size:0.95rem; color:#111827; background:#fff; font-family:inherit; resize:vertical; margin-bottom:14px;"></textarea>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="adjust-modal-close" style="padding:10px 16px; border-radius:8px; border:1px solid #d0d7de; background:#f1f5fa; color:#53657d; cursor:pointer; font-weight:600;">Cancel</button>
        <button id="adjSubmit" style="padding:10px 16px; border-radius:8px; border:none; background:rgba(170,27,27,0.9); color:white; cursor:pointer; font-weight:600;">Apply Adjustment</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  const typeSelect = overlayEl.querySelector("#adjType");
  const recordSelect = overlayEl.querySelector("#adjRecord");
  const recordLabel = overlayEl.querySelector("#adjRecordLabel");
  const currentValueEl = overlayEl.querySelector("#adjCurrentValue");
  const newValueInput = overlayEl.querySelector("#adjNewValue");
  const reasonInput = overlayEl.querySelector("#adjReason");

  let records = { payments: [], expenses: [] };
  let selectedRecord = null;

  async function refreshType() {
    const type = typeSelect.value;
    recordSelect.innerHTML = "";
    recordSelect.style.display = "none";
    recordLabel.style.display = "none";
    selectedRecord = null;
    if (type === "payment" || type === "expense") {
      try {
        const [payments, expenses] = await Promise.all([
          window.api.listJobPayments(job.id),
          window.api.listJobExpenses(job.id)
        ]);
        records = { payments, expenses };
        const list = type === "payment" ? payments : expenses;
        recordSelect.style.display = "block";
        recordLabel.style.display = "block";
        list.forEach((r) => {
          const option = document.createElement("option");
          option.value = r.id;
          const date = r.payment_date || r.expense_date ? new Date(r.payment_date || r.expense_date).toLocaleDateString("en-US") : "";
          option.textContent = `${type === "payment" ? "Payment" : "Expense"} #${r.id} — $${money(r.amount)}${date ? ` (${date})` : ""}`;
          recordSelect.appendChild(option);
        });
        if (list[0]) { recordSelect.value = list[0].id; onRecordChange(); }
      } catch (err) {
        console.error(err);
        showToast("Failed to load records", "error");
      }
    } else if (type === "total_due") {
      currentValueEl.textContent = "$" + money(job.finance.total_due);
    } else if (type === "job_cost") {
      currentValueEl.textContent = "$" + money(job.finance.job_cost);
    }
  }

  function onRecordChange() {
    const type = typeSelect.value;
    const id = Number(recordSelect.value);
    const list = type === "payment" ? records.payments : records.expenses;
    const found = list.find((r) => Number(r.id) === id);
    selectedRecord = found || null;
    currentValueEl.textContent = "$" + money(found ? found.amount : 0);
  }

  typeSelect.addEventListener("change", refreshType);
  recordSelect.addEventListener("change", onRecordChange);

  overlayEl.querySelectorAll(".adjust-modal-close").forEach((btn) =>
    btn.addEventListener("click", () => overlayEl.remove())
  );
  overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) overlayEl.remove(); });

  overlayEl.querySelector("#adjSubmit").addEventListener("click", async () => {
    const type = typeSelect.value;
    const newValue = parseMoney(newValueInput.value);
    const reason = reasonInput.value.trim();
    if (reason.length < 3) { showToast("A reason is required (min 3 characters)", "error"); return; }
    const payload = {
      jobId: job.id,
      recordType: type,
      newValue,
      reason
    };
    if (type === "payment" || type === "expense") {
      if (!selectedRecord) { showToast("Select a record to adjust", "error"); return; }
      payload.recordId = selectedRecord.id;
      payload.oldValue = Number(selectedRecord.amount || 0);
    } else {
      payload.oldValue = type === "total_due" ? job.finance.total_due : job.finance.job_cost;
    }
    try {
      const submit = overlayEl.querySelector("#adjSubmit");
      submit.disabled = true;
      submit.textContent = "Applying...";
      await window.api.adminCreateAdjustment(payload);
      overlayEl.remove();
      showToast("Adjustment applied and logged", "success");
      await openJob(job.id);
      refreshList();
      triggerFinanceUpdate();
      refreshNotificationBadge();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Adjustment failed", "error");
      const submit = overlayEl.querySelector("#adjSubmit");
      submit.disabled = false;
      submit.textContent = "Apply Adjustment";
    }
  });

  refreshType();
}

// ============================================================================
// JOB LINE ITEMS (estimate/invoice) + SALES PERSON
// ============================================================================
async function setupJobLineItems(job) {
  const container = document.getElementById("jobLineItems");
  if (!container) return;
  const addBtn = document.getElementById("addLineItemBtn");
  const saveBtn = document.getElementById("saveLineItemsBtn");
  const estBtn = document.getElementById("jobEstimateBtn");
  const invBtn = document.getElementById("jobInvoiceBtn");

  let items = Array.isArray(job.line_items) && job.line_items.length
    ? job.line_items.slice()
    : await window.api.listLineItems(job.id);

  function render() {
    if (!items.length) {
      container.innerHTML = `<div style="color:#888; font-size:13px;">No line items yet. Add them below.</div>`;
      return;
    }
    const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    container.innerHTML = items.map((li, idx) => `
      <div class="job-finance-row">
        <span style="flex:2;">${escapeHtml(li.description || "Item")}</span>
        <span>${Number(li.quantity) || 1} × $${money(li.unit_price)}</span>
        <span style="font-weight:700;">$${money(li.amount)}</span>
        <button data-del-line="${idx}" style="background:none; border:none; color:#e5484d; cursor:pointer; font-size:0.9rem;">×</button>
      </div>
    `).join("") + `<div class="job-finance-row" style="justify-content:flex-end; font-weight:700;">Total: $${money(total)}</div>`;
    container.querySelectorAll("[data-del-line]").forEach((btn) => {
      btn.addEventListener("click", () => { items.splice(Number(btn.dataset.delLine), 1); render(); });
    });
  }
  render();

  if (addBtn) {
    const desc = document.getElementById("liDesc");
    const qty = document.getElementById("liQty");
    const price = document.getElementById("liPrice");
    addBtn.addEventListener("click", () => {
      const d = desc ? desc.value.trim() : "";
      const q = qty ? parseMoney(qty.value) : 1;
      const p = price ? parseMoney(price.value) : 0;
      if (!d) { showToast("Description is required", "error"); return; }
      items.push({ description: d, quantity: q || 1, unit_price: p, amount: (q || 1) * p });
      if (desc) desc.value = "";
      if (qty) qty.value = "";
      if (price) price.value = "";
      render();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      try {
        const result = await window.api.saveLineItems(job.id, items);
        items = result.items || [];
        showToast("Line items saved", "success");
        render();
        const updated = await window.api.getJob(job.id);
        if (updated.job && updated.job.finance) {
          const el = document.getElementById("jobDueDisplay"); if (el) el.textContent = "$" + money(updated.job.finance.total_due);
          const bal = document.getElementById("jobBalanceDisplay"); if (bal) bal.textContent = "$" + money(updated.job.finance.balance_due);
        }
        refreshList();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to save line items", "error");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Line Items";
      }
    });
  }

  if (estBtn) estBtn.addEventListener("click", async () => { try { await window.api.sendJobEstimate(job.id); showToast("Estimate downloaded", "success"); } catch (err) { showToast(err.message || "Failed to generate estimate", "error"); } });
  if (invBtn) invBtn.addEventListener("click", async () => { try { await window.api.sendJobInvoice(job.id); showToast("Invoice downloaded", "success"); } catch (err) { showToast(err.message || "Failed to generate invoice", "error"); } });
}

async function setupJobSalesSelect(job) {
  const sel = document.getElementById("jobSalesSelect");
  if (!sel || !isAdmin()) return;
  const users = await getSalesUsers();
  sel.innerHTML = `<option value="">Unassigned</option>` + users.map((u) => `<option value="${u.id}" ${Number(job.sales_user_id) === Number(u.id) ? "selected" : ""}>${escapeHtml(u.name || u.email)}</option>`).join("");
  sel.addEventListener("change", async () => {
    try {
      await window.api.setJobSalesUser(job.id, sel.value || null);
      showToast("Sales person saved", "success");
      refreshList();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to assign sales person", "error");
    }
  });
}

// ============================================================================
// JOB PANEL ACTIONS
// ============================================================================
function setupJobPanelActions(job) {
  const backBtn = document.getElementById("backToClientBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => openClient(job.client_id));
  }

  const saveBtn = document.getElementById("saveJobBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      try {
        const result = await window.api.updateJob(job.id, {
          name: document.getElementById("jobNameInput")?.value || job.name,
          status: document.getElementById("jobStatusSelect")?.value || job.status,
          address: document.getElementById("jobAddressInput")?.value || "",
          scope_of_work: document.getElementById("jobScopeInput")?.value || "",
          job_cost: job.finance.job_cost,
          total_due: job.finance.total_due
        });
        const statusChanged = job.status !== result.job.status;
        job.status = result.job.status;
        job.name = result.job.name;
        job.scope_of_work = result.job.scope_of_work;
        job.address = result.job.address;
        if (isAdmin() && result.job.tags && Array.isArray(result.job.tags)) job.tags = result.job.tags;
        setSaveStatus("saved");
        // Approval state changed → refresh the panel so the finance lock notice
        // and payment controls reflect the new status.
        if (statusChanged) {
          showToast("Job saved", "success");
          await openJob(job.id);
          refreshList();
          refreshNotificationBadge();
          return;
        }
        showToast("Job saved", "success");
        refreshList();
        refreshNotificationBadge();
      } catch (err) {
        console.error(err);
        setSaveStatus("error");
        showToast(err.message || "Failed to save job", "error");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Job";
      }
    });
  }

  const printBtn = document.getElementById("printJobBtn");
  if (printBtn) printBtn.addEventListener("click", () => printClientWorkspace());

  const deleteBtn = document.getElementById("deleteJobBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Permanently delete this job? Payments/expenses stay with the client.`)) return;
      try {
        await window.api.deleteJob(job.id);
        showToast("Job deleted", "success");
        await refreshList();
        closePanel();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to delete job", "error");
      }
    });
  }

  const closeBtn = document.getElementById("closeJobBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", async () => {
      await saveJobQuietly(job);
      closePanel();
    });
  }

  const adjustBtn = document.getElementById("adminAdjustBtn");
  if (adjustBtn && isAdmin()) {
    adjustBtn.addEventListener("click", () => openAdjustmentModal(job));
  }
}

async function saveJobQuietly(job) {
  try {
    const name = document.getElementById("jobNameInput")?.value;
    const status = document.getElementById("jobStatusSelect")?.value;
    const address = document.getElementById("jobAddressInput")?.value;
    const scope = document.getElementById("jobScopeInput")?.value;
    const payload = { id: job.id };
    if (name !== undefined && name !== job.name) payload.name = name;
    if (status !== undefined && status !== job.status) payload.status = status;
    if (address !== undefined && address !== job.address) payload.address = address;
    if (scope !== undefined && scope !== job.scope_of_work) payload.scope_of_work = scope;
    await window.api.updateJob(job.id, payload);
    refreshList();
    refreshNotificationBadge();
  } catch (err) {
    console.error(err);
  }
}

// ============================================================================
// CLIENT PANEL — save / delete / print / close / invoice actions
// ============================================================================
async function saveClientContact() {
  if (!activeId) return;
  const data = {
    id: activeId,
    fName: document.getElementById("p-fname")?.value || "",
    lName: document.getElementById("p-lname")?.value || "",
    phone: document.getElementById("p-phone")?.value || "",
    email: document.getElementById("p-email")?.value || "",
    address: document.getElementById("p-address")?.value || ""
  };
  try {
    setSaveStatus("saving");
    await savePendingNotes({ silent: true });
    await window.api.updateProject(data);
    setSaveStatus("saved");
    showToast("Saved", "success");
    await refreshList();
    return true;
  } catch (err) {
    console.error(err);
    setSaveStatus("error");
    showToast("Save failed", "error");
    return false;
  }
}

// ============================================================================
// CLOSE CURRENT PANEL (mode-aware; used by Esc key)
// ============================================================================
async function closeCurrentPanel() {
  if (panelMode === "job" && activeJobId) {
    await saveJobQuietly({ id: activeJobId });
    closePanel();
    return;
  }
  if (panelMode === "client" && activeId) {
    await saveClientContact();
    closePanel();
    return;
  }
  await savePanelChanges({ silent: true, force: true });
  closePanel();
}

// ============================================================================
// JOB SIDEBAR (tag-filtered view)
// ============================================================================
async function refreshJobSidebar() {
  if (!clientList) return;
  try {
    sidebarJobsCache = activeTagFilter ? await window.api.searchJobsByTag(activeTagFilter) : [];
    renderSidebarJobs(sidebarJobsCache);
  } catch (err) {
    console.error(err);
    clientList.innerHTML = `<li class="empty-state">Unable to load jobs.</li>`;
  }
}

function filterJobSidebar(term) {
  const t = String(term || "").trim().toLowerCase();
  const filtered = t
    ? sidebarJobsCache.filter((j) => `${j.name || ""} ${j.client_name || ""} ${j.status || ""}`.toLowerCase().includes(t))
    : sidebarJobsCache;
  renderSidebarJobs(filtered);
}

function renderSidebarJobs(jobs) {
  if (!clientList) return;
  if (!jobs.length) {
    clientList.innerHTML = `<li class="empty-state">No jobs with this tag.</li>`;
    return;
  }
  clientList.innerHTML = jobs.map((j) => {
    const color = STATUS_COLORS[j.status] || "#007bff";
    return `
      <div class="client-card" data-kind="job" data-id="${j.id}" style="border-left:4px solid ${color};">
        <div class="client-name">🔧 ${escapeHtml(j.name || "Untitled job")}</div>
        <div class="client-meta">👤 ${escapeHtml(j.client_name || "")}</div>
        <div class="client-status" style="color:${color};">${escapeHtml(j.status || "")}</div>
      </div>
    `;
  }).join("");
}
