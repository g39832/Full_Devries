// ============================================================================
// main-renderer-v3.js — Roles, Tag filters, Notifications, Settings
// Loaded AFTER main-renderer-v2.js.
// ============================================================================

// ============================================================================
// SESSION / ROLE
// ============================================================================
async function initSession() {
  try {
    const user = await window.api.getMe();
    currentUser = user;
    const badge = document.getElementById("userBadge");
    if (badge) {
      const roleLabel = user.role === "admin" ? "Admin" : "User";
      badge.textContent = `${user.name || user.email} (${roleLabel})`;
      badge.style.display = "inline-block";
      badge.title = user.email;
    }
    const usersTabBtn = document.getElementById("usersTabBtn");
    if (usersTabBtn) usersTabBtn.style.display = user.role === "admin" ? "inline-block" : "none";
    const activityTabBtn = document.getElementById("activityTabBtn");
    if (activityTabBtn) activityTabBtn.style.display = user.role === "admin" ? "inline-block" : "none";
    if (user.role !== "admin") {
      ["toggleFinance", "companyProfileBtn", "emailSettingsBtn", "salesPersonFilterWrap"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
      });
    }
    return user;
  } catch (err) {
    console.warn("Not authenticated — redirecting to login.", err);
    window.location.href = "/";
    return null;
  }
}

function isAdmin() {
  return Boolean(currentUser && currentUser.role === "admin");
}

async function handleLogout() {
  try {
    await window.api.logout();
  } catch (err) {
    console.error(err);
  }
  window.location.href = "/";
}

// ============================================================================
// TAG FILTER BAR (clicking a tag filters all jobs)
// ============================================================================
async function loadTagFilterBar() {
  const bar = document.getElementById("tagFilterBar");
  if (!bar) return;
  // Only show the bar when a job-tag filter is active (active chip + clear).
  if (!activeTagFilter) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }
  try {
    if (!allTagsCache.length) allTagsCache = await window.api.listTags();
    const tag = allTagsCache.find((t) => Number(t.id) === Number(activeTagFilter));
    bar.innerHTML =
      `<span class="tag-filter-label">Job tag:</span>` +
      (tag ? `<button type="button" class="tag-chip active" data-tag-id="${tag.id}">${escapeHtml(tag.name)}</button>` : "") +
      `<button type="button" class="tag-chip tag-chip-clear" data-clear-tag="1">✕ clear</button>`;
    bar.style.display = "flex";
    bar.querySelectorAll("[data-tag-id]").forEach((btn) => {
      btn.addEventListener("click", () => toggleTagFilter(Number(btn.dataset.tagId)));
    });
    const clearBtn = bar.querySelector("[data-clear-tag]");
    if (clearBtn) clearBtn.addEventListener("click", () => toggleTagFilter(activeTagFilter));
  } catch (err) {
    console.error(err);
  }
}

async function refreshTagFilterBar() {
  await loadTagFilterBar();
  await loadClientTagFilterBar();
}

async function toggleTagFilter(tagId) {
  activeTagFilter = activeTagFilter === tagId ? null : tagId;
  if (activeTagFilter) {
    activeSalesFilter = null;
    setDashboardView("jobs");
  }
  await loadTagFilterBar();
  await refreshList();
  renderClientFilterNotice();
  showToast(activeTagFilter ? "Filtering jobs by tag…" : "Tag filter cleared", "info");
}

// ============================================================================
// PRIMARY CLIENT TAG FILTER (filters the client list)
// ============================================================================
async function loadClientTagFilterBar() {
  const bar = document.getElementById("clientTagFilterBar");
  if (!bar) return;
  try {
    if (!allTagsCache.length) allTagsCache = await window.api.listTags();
    const clientTags = allTagsCache.filter((t) => t.kind === 'client');
    if (!clientTags.length) {
      bar.style.display = "none";
      bar.innerHTML = "";
      return;
    }
    bar.innerHTML =
      `<span class="tag-filter-label">Client tag:</span>` +
      clientTags.map((t) =>
        `<button type="button" class="tag-chip${activeClientTagFilter === Number(t.id) ? " active" : ""}" data-client-tag-id="${t.id}">${escapeHtml(t.name)}</button>`
      ).join("") +
      (activeClientTagFilter ? `<button type="button" class="tag-chip tag-chip-clear" data-clear-client-tag="1">✕ clear</button>` : "");
    bar.style.display = "flex";
    bar.querySelectorAll("[data-client-tag-id]").forEach((btn) => {
      btn.addEventListener("click", () => toggleClientTagFilter(Number(btn.dataset.clientTagId)));
    });
    const clearBtn = bar.querySelector("[data-clear-client-tag]");
    if (clearBtn) clearBtn.addEventListener("click", () => toggleClientTagFilter(activeClientTagFilter));
  } catch (err) {
    console.error(err);
  }
}

async function toggleClientTagFilter(tagId) {
  activeClientTagFilter = activeClientTagFilter === tagId ? null : tagId;
  if (activeClientTagFilter) {
    setDashboardView("clients");
  }
  await loadClientTagFilterBar();
  await loadTagFilterBar();
  await refreshList();
  renderClientFilterNotice();
  showToast(activeClientTagFilter ? "Filtering clients by tag…" : "Client tag filter cleared", "info");
}

async function refreshClientTagSidebar() {
  if (!clientList) return;
  try {
    const [filteredClients, allClients] = await Promise.all([
      window.api.searchClientsByPrimaryTag(activeClientTagFilter),
      window.api.searchClients("")
    ]);
    renderSidebar(filteredClients || [], "", allClients || []);
  } catch (err) {
    console.error(err);
    clientList.innerHTML = `<li class="empty-state">Unable to load clients.</li>`;
  }
}

// Compact "Filtered by <tag> ✕ clear" banner shown above the client list when
// a primary client tag filter is active (replaces the removed sidebar tag bar).
function renderClientFilterNotice() {
  const notice = document.getElementById("clientFilterNotice");
  if (!notice) return;
  if (!activeClientTagFilter) {
    notice.style.display = "none";
    notice.innerHTML = "";
    return;
  }
  const tag = (allTagsCache || []).find((t) => Number(t.id) === Number(activeClientTagFilter));
  notice.innerHTML = `<span class="client-filter-notice-text">Filtered by: ${escapeHtml(tag ? tag.name : "tag")}</span><button type="button" class="client-filter-clear" data-clear-client-filter="1">✕ clear</button>`;
  notice.style.display = "flex";
}

// ============================================================================
// ADMIN SALES-PERSON FILTER (filters the job list by assigned sales user)
// ============================================================================
async function setupSalesFilter() {
  const wrap = document.getElementById("salesPersonFilterWrap");
  const select = document.getElementById("salesPersonFilter");
  if (!wrap || !select) return;
  if (!isAdmin()) { wrap.style.display = "none"; return; }
  wrap.style.display = "inline-flex";
  try {
    const users = await window.api.adminUsers();
    select.innerHTML = `<option value="">All sales people</option>` +
      users.map((u) => `<option value="${u.id}" ${activeSalesFilter === Number(u.id) ? "selected" : ""}>${escapeHtml(u.name || u.email)}</option>`).join("");
  } catch (err) {
    console.error(err);
  }
  select.addEventListener("change", async () => {
    const val = select.value;
    activeSalesFilter = val ? Number(val) : null;
    if (activeSalesFilter) { activeTagFilter = null; activeClientTagFilter = null; }
    await loadTagFilterBar();
    await loadClientTagFilterBar();
    await refreshList();
    renderClientFilterNotice();
    showToast(activeSalesFilter ? "Filtering jobs by sales person…" : "Sales filter cleared", "info");
  });
}

async function refreshSalesSidebar() {
  if (!clientList) return;
  try {
    const jobs = await window.api.searchJobsBySalesUser(activeSalesFilter);
    renderSidebarJobs(jobs);
  } catch (err) {
    console.error(err);
    clientList.innerHTML = `<li class="empty-state">Unable to load jobs.</li>`;
  }
}

// ============================================================================
// FRONT PAGE — GROUPED DASHBOARD (clients with their jobs nested inside)
// ============================================================================
async function refreshJobDashboard() {
  if (!clientList) return;
  try {
    const [clients, jobs] = await Promise.all([
      activeClientTagFilter
        ? window.api.searchClientsByPrimaryTag(activeClientTagFilter)
        : window.api.searchClients(""),
      window.api.listAllJobs({
        status: activeJobStatusFilter || undefined,
        tag_id: activeTagFilter || undefined,
        sales_user_id: activeSalesFilter || undefined,
        primary_tag_id: activeClientTagFilter || undefined
      })
    ]);
    renderGroupedDashboard(clients || [], jobs || []);
  } catch (err) {
    console.error(err);
    clientList.innerHTML = `<li class="empty-state">Unable to load clients.</li>`;
  }
}

function renderGroupedDashboard(clients, jobs) {
  if (!clientList) return;
  renderJobStatusTabs();

  const jobsByClient = new Map();
  (jobs || []).forEach((j) => {
    const key = Number(j.client_id);
    if (!jobsByClient.has(key)) jobsByClient.set(key, []);
    jobsByClient.get(key).push(j);
  });

  const clientIds = new Set((clients || []).map((c) => Number(c.id)));
  const hasJobFilter = Boolean(activeJobStatusFilter || activeTagFilter || activeSalesFilter || activeClientTagFilter);

  const blocks = (clients || []).map((c) => {
    const cJobs = jobsByClient.get(Number(c.id)) || [];
    // When a job-level filter is active, only show clients that have a matching job.
    if (hasJobFilter && !cJobs.length) return "";
    return renderGroupedClientBlock(c, cJobs);
  }).join("");

  // Defensive: surface jobs whose client wasn't returned (shouldn't normally happen).
  const orphanJobs = (jobs || []).filter((j) => !clientIds.has(Number(j.client_id)));
  const orphanHtml = orphanJobs.length
    ? `<li class="grouped-orphan" style="list-style:none;">${orphanJobs.map(renderJobDashboardCard).join("")}</li>`
    : "";

  const html = blocks + orphanHtml;
  if (!html) {
    clientList.innerHTML = hasJobFilter
      ? `<li class="empty-state">No matching jobs.</li>`
      : `<li class="empty-state">No clients yet. Add a new lead to get started.</li>`;
    return;
  }
  clientList.innerHTML = html;
}

function renderGroupedClientBlock(c, cJobs) {
  const color = STATUS_COLORS[c.status] || "#007bff";
  const primaryTag = c.primary_tag_name
    ? `<span class="client-primary-tag-mini">${escapeHtml(c.primary_tag_name)}</span>`
    : "";
  const meta = [
    c.phone ? `📞 ${escapeHtml(c.phone)}` : "",
    c.email ? `✉️ ${escapeHtml(c.email)}` : "",
    c.address ? `📍 ${escapeHtml(c.address)}` : ""
  ].filter(Boolean).join(" ");
  return `
    <li class="grouped-client" style="list-style:none;">
      <div class="client-card grouped-client-head" data-kind="client" data-id="${c.id}" style="border-left:4px solid ${color};">
        <div class="grouped-client-head-row">
          <div class="client-name">${escapeHtml(c.name || "Unknown client")}</div>
          <div class="client-status" style="color:${color};">${escapeHtml(c.status || "Lead")}</div>
        </div>
        ${meta || primaryTag ? `<div class="client-meta">${meta}${meta && primaryTag ? " " : ""}${primaryTag}</div>` : ""}
      </div>
      ${cJobs.length ? `<div class="grouped-jobs">${cJobs.map(renderJobDashboardCard).join("")}</div>` : ""}
    </li>
  `;
}

function renderJobDashboardCard(j) {
  const color = STATUS_COLORS[j.status] || "#007bff";
  const fin = j.finance || {};
  const tags = (j.tags || []).map((t) =>
    `<button type="button" class="job-dash-tag" data-job-tag-id="${t.id}">${escapeHtml(t.name)}</button>`
  ).join("");
  const balance = Number(fin.balance_due || 0);
  const margin = fin.margin_pct != null && fin.margin_pct !== "" ? `${fin.margin_pct}%` : "";
  const pieces = [];
  if (isAdmin() && balance) pieces.push(`<span>Balance: ${formatMoney(balance)}</span>`);
  if (isAdmin() && margin) pieces.push(`<span>Margin: ${margin}</span>`);
  if (j.note_count) pieces.push(`<span title="Notes">📝 ${j.note_count}</span>`);
  return `
    <div class="client-card job-dash-card" data-kind="job" data-id="${j.id}" style="border-left:4px solid ${color};">
      <div class="job-dash-top">
        <div class="job-dash-name">🔧 ${escapeHtml(j.name || "Untitled job")}</div>
        <span class="job-dash-status" style="color:${color};">${escapeHtml(j.status || "")}</span>
      </div>
      <div class="job-dash-meta">
        ${j.sales_person_name ? `<span class="job-dash-sales">Sales: ${escapeHtml(j.sales_person_name)}</span>` : ""}
        ${tags ? `<span class="job-tags-row">${tags}</span>` : ""}
      </div>
      ${pieces.length ? `<div class="job-dash-fin">${pieces.join("")}</div>` : ""}
    </div>
  `;
}

function renderJobStatusTabs() {
  const bar = document.getElementById("statusFilterBar");
  if (!bar) return;
  bar.innerHTML =
    `<button type="button" class="job-status-tab${!activeJobStatusFilter ? " active" : ""}" data-job-status-tab="">All</button>` +
    STATUS_ORDER.map((s) =>
      `<button type="button" class="job-status-tab${activeJobStatusFilter === s ? " active" : ""}" data-job-status-tab="${s}">${s}</button>`
    ).join("");
}

async function setJobStatusFilter(status) {
  activeJobStatusFilter = status || null;
  await refreshJobDashboard();
}

function setDashboardView(view) {
  // The front page is a flat client list; a job filter and a client filter are
  // mutually exclusive, so clear the opposing one when switching.
  dashboardView = view === "clients" ? "clients" : "jobs";
  if (dashboardView === "clients") {
    activeTagFilter = null;
    activeJobStatusFilter = null;
  } else {
    activeClientTagFilter = null;
    activeStatusFilter = null;
  }
  renderClientFilterNotice();
}

function setupDashboardView() {
  // No job-dashboard status tabs on the front page; keep the bar hidden.
  const statusBar = document.getElementById("statusFilterBar");
  if (statusBar) statusBar.style.display = "none";
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================
async function refreshNotificationBadge() {
  const badge = document.getElementById("notificationsBadge");
  if (!badge) return;
  try {
    const data = await window.api.listNotifications();
    const unread = Number(data.unread || 0);
    if (unread > 0) {
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadNotifications() {
  const list = document.getElementById("notificationsList");
  if (!list) return;
  list.innerHTML = `<div style="color:#888; font-size:13px; padding:8px;">Loading…</div>`;
  try {
    const data = await window.api.listNotifications();
    const items = data.notifications || [];
    if (!items.length) {
      list.innerHTML = `<div style="color:#888; font-size:13px; padding:8px;">No notifications yet.</div>`;
      return;
    }
    list.innerHTML = items.map((n) => {
      const date = n.created_at ? new Date(n.created_at).toLocaleString("en-US") : "";
      const icon = {
        approved: "✅", awaiting_approval: "⏳", job_added: "🛠️", payment: "💰",
        overpayment: "🔄", expense: "🧾", finance_disabled: "🔒", needs_attention: "⚠️"
      }[n.type] || "🔔";
      return `
        <div class="notification-item${n.is_read ? " read" : ""}" data-notification-id="${n.id || ""}" data-entity-type="${escapeHtml(n.entity_type || "")}" data-entity-id="${n.entity_id || ""}">
          <div class="notification-icon">${icon}</div>
          <div class="notification-body">
            <div>${escapeHtml(n.message)}</div>
            <small>${date}</small>
          </div>
        </div>`;
    }).join("");
    refreshNotificationBadge();
  } catch (err) {
    console.error(err);
    list.innerHTML = `<div style="color:#888; font-size:13px; padding:8px;">Unable to load notifications.</div>`;
  }
}

function toggleNotificationsPanel() {
  const panel = document.getElementById("notificationsPanel");
  if (!panel) return;
  notificationsOpen = !notificationsOpen;
  panel.style.display = notificationsOpen ? "block" : "none";
  if (notificationsOpen) loadNotifications();
}

async function setupNotifications() {
  const btn = document.getElementById("notificationsBtn");
  if (btn) btn.addEventListener("click", toggleNotificationsPanel);

  const markAll = document.getElementById("markAllReadBtn");
  if (markAll) {
    markAll.addEventListener("click", async () => {
      try {
        await window.api.markAllNotificationsRead();
        loadNotifications();
      } catch (err) {
        console.error(err);
        showToast("Failed to mark notifications read", "error");
      }
    });
  }

  const panel = document.getElementById("notificationsPanel");
  const list = document.getElementById("notificationsList");
  if (list) {
    list.addEventListener("click", async (e) => {
      const item = e.target.closest(".notification-item");
      if (!item) return;
      const id = item.dataset.notificationId;
      if (id && !item.classList.contains("read")) {
        try {
          await window.api.markNotificationRead(id);
          item.classList.add("read");
          refreshNotificationBadge();
        } catch (err) {
          console.error(err);
        }
      }
      // Click-to-navigate: open the referenced job or client.
      const entityType = item.dataset.entityType;
      const entityId = Number(item.dataset.entityId);
      if (entityType === "job" && Number.isInteger(entityId) && entityId > 0) {
        notificationsOpen = false;
        panel.style.display = "none";
        openJob(entityId);
      } else if (entityType === "client" && Number.isInteger(entityId) && entityId > 0) {
        notificationsOpen = false;
        panel.style.display = "none";
        openClient(entityId);
      }
    });
  }

  // Close panel on outside click
  document.addEventListener("click", (e) => {
    if (!notificationsOpen || !panel) return;
    if (!panel.contains(e.target) && !document.getElementById("notificationsBtn")?.contains(e.target)) {
      notificationsOpen = false;
      panel.style.display = "none";
    }
  });

  await refreshNotificationBadge();
  setInterval(() => refreshNotificationBadge(), 60000);
}

// ============================================================================
// SETTINGS MODAL
// ============================================================================
function openSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (!modal) return;
  modal.style.display = "flex";
  renderSettingsTags();
  if (isAdmin()) {
    renderSettingsUsers();
    renderSettingsActivity();
  }
  renderSettingsAccount();
}

function closeSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (modal) modal.style.display = "none";
}

async function renderSettingsTags() {
  const container = document.getElementById("settingsTabTags");
  if (!container) return;
  container.innerHTML = `<div style="color:#888;">Loading tags…</div>`;
  try {
    const tags = await window.api.listTags();
    allTagsCache = tags;
    const admin = isAdmin();
    container.innerHTML = `
      <div style="margin-bottom:12px;">
        <strong>Tags</strong>
        <p style="margin:2px 0 8px; color:#53657d; font-size:0.85rem;">Two kinds of tags: <strong>Client tags</strong> (one primary tag per client, for sorting) and <strong>Job tags</strong> (many per job).</p>
      </div>
      ${admin ? `
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <select id="newTagKind" style="padding:8px 10px; border-radius:8px; border:1px solid #d0d7de; font-size:0.92rem; color:#111827; background:#fff;">
            <option value="job">Job tag</option>
            <option value="client">Client tag</option>
          </select>
          <input id="newTagName" type="text" placeholder="New tag name" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #d0d7de; font-size:0.92rem; color:#111827; background:#fff;">
          <button id="createTagBtn" style="padding:8px 14px; border-radius:8px; border:none; background:linear-gradient(135deg,#2f80ed,#4f8dfd); color:#fff; cursor:pointer; font-weight:600;">Add Tag</button>
        </div>
      ` : `<p style="color:#53657d; font-size:0.85rem;">Only admins can create, rename, or remove tags.</p>`}
      <div id="tagsListWrap">${renderTagsRows(tags, admin)}</div>
    `;
    if (admin) {
      const createBtn = document.getElementById("createTagBtn");
      const input = document.getElementById("newTagName");
      const kindSelect = document.getElementById("newTagKind");
      if (createBtn && input) {
        createBtn.addEventListener("click", async () => {
          const name = input.value.trim();
          if (!name) { showToast("Tag name is required", "error"); return; }
          try {
            await window.api.createTag(name, kindSelect ? kindSelect.value : "job");
            input.value = "";
            showToast("Tag created", "success");
            renderSettingsTags();
            refreshTagFilterBar();
          } catch (err) {
            showToast(err.message || "Failed to create tag", "error");
          }
        });
      }
      const wrap = document.getElementById("tagsListWrap");
      if (wrap) {
        wrap.addEventListener("click", async (e) => {
          const rename = e.target.closest("[data-rename-tag]");
          const del = e.target.closest("[data-del-tag]");
          if (rename) {
            const id = Number(rename.dataset.renameTag);
            const current = rename.dataset.name;
            const next = prompt("Rename tag to:", current);
            if (!next || !next.trim() || next.trim() === current) return;
            try {
              await window.api.renameTag(id, next.trim());
              showToast("Tag renamed — all jobs keep this tag", "success");
              renderSettingsTags();
              loadTagFilterBar();
            } catch (err) {
              showToast(err.message || "Failed to rename tag", "error");
            }
          }
          if (del) {
            const id = Number(del.dataset.delTag);
            const name = del.dataset.name;
            if (!confirm(`Delete tag "${name}"? Jobs keep all their other data.`)) return;
            try {
              await window.api.deleteTag(id);
              showToast("Tag deleted", "success");
              renderSettingsTags();
              loadTagFilterBar();
            } catch (err) {
              showToast(err.message || "Failed to delete tag", "error");
            }
          }
        });
      }
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div style="color:#888;">Unable to load tags.</div>`;
  }
}

function renderTagsRows(tags, admin) {
  if (!tags.length) return `<div style="color:#888; font-size:0.9rem;">No tags yet.</div>`;
  return `<div style="display:flex; flex-wrap:wrap; gap:8px;">` + tags.map((t) => {
    const isClient = t.kind === 'client';
    const count = isClient ? Number(t.client_count || 0) : Number(t.job_count || 0);
    const unit = isClient ? "client" : "job";
    return `
    <div style="display:flex; align-items:center; gap:6px; background:#f1f5fa; border:1px solid #e2e8f0; border-radius:20px; padding:4px 10px;">
      <span style="font-weight:600; color:#1e3c72; font-size:0.9rem;">${escapeHtml(t.name)}</span>
      <span style="color:#64748b; font-size:0.75rem; background:${isClient ? "#eef2ff" : "#eafaf1"}; border-radius:10px; padding:1px 8px;">${isClient ? "client" : "job"}</span>
      <span style="color:#64748b; font-size:0.8rem;">(${count} ${unit}${count === 1 ? "" : "s"})</span>
      ${admin ? `
        <button type="button" data-rename-tag="${t.id}" data-name="${escapeHtml(t.name)}" title="Rename" style="background:none; border:none; cursor:pointer; color:#2f80ed; font-size:0.9rem;">✎</button>
        <button type="button" data-del-tag="${t.id}" data-name="${escapeHtml(t.name)}" title="Delete" style="background:none; border:none; cursor:pointer; color:#e5484d; font-size:0.9rem;">🗑</button>
      ` : ""}
    </div>`;
  }).join("") + `</div>`;
}

async function renderSettingsUsers() {
  const container = document.getElementById("settingsTabUsers");
  if (!container) return;
  container.innerHTML = `<div style="color:#888;">Loading users…</div>`;
  try {
    const users = await window.api.adminUsers();
    container.innerHTML = `
      <div style="margin-bottom:12px;">
        <strong>Users</strong>
        <p style="margin:2px 0 8px; color:#53657d; font-size:0.85rem;">Normal Users cannot reach admin functions — enforcement is server-side.</p>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
        <thead><tr style="text-align:left; color:#53657d;"><th style="padding:6px;">Name</th><th style="padding:6px;">Email</th><th style="padding:6px;">Role</th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr style="border-top:1px solid #eef2f7;">
              <td style="padding:6px; color:#1e3c72;">${escapeHtml(u.name || "")}</td>
              <td style="padding:6px; color:#1e3c72;">${escapeHtml(u.email || "")}</td>
              <td style="padding:6px;">
                <select data-user-role="${u.id}" ${Number(u.id) === Number(currentUser?.id) ? "disabled title='You cannot change your own role'" : ""} style="padding:4px 6px; border-radius:6px; border:1px solid #d0d7de; color:#111827; background:#fff;">
                  <option value="user" ${u.role === "user" ? "selected" : ""}>User</option>
                  <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
                </select>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    `;
    container.querySelectorAll("[data-user-role]").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          await window.api.adminSetUserRole(Number(select.dataset.userRole), select.value);
          showToast("Role updated", "success");
        } catch (err) {
          console.error(err);
          showToast(err.message || "Failed to update role", "error");
          select.value = select.value === "admin" ? "user" : "admin";
        }
      });
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div style="color:#888;">Unable to load users.</div>`;
  }
}

async function renderSettingsActivity() {
  const container = document.getElementById("settingsTabActivity");
  if (!container) return;
  container.innerHTML = `<div style="color:#888;">Loading activity…</div>`;
  try {
    const data = await window.api.adminActivity();
    const items = data.activity || [];
    if (!items.length) {
      container.innerHTML = `<div style="color:#888;">No activity recorded yet.</div>`;
      return;
    }
    container.innerHTML = `
      <div style="margin-bottom:12px;">
        <strong>Activity Log</strong>
        <p style="margin:2px 0 8px; color:#53657d; font-size:0.85rem;">Who did what — newest first.</p>
      </div>
      <div style="max-height:420px; overflow:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.86rem;">
          <thead>
            <tr style="text-align:left; color:#53657d;">
              <th style="padding:6px;">When</th>
              <th style="padding:6px;">Who</th>
              <th style="padding:6px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((a) => `
              <tr style="border-top:1px solid #eef2f7;">
                <td style="padding:6px; color:#53657d; white-space:nowrap;">${escapeHtml(new Date(a.created_at).toLocaleString("en-US"))}</td>
                <td style="padding:6px; color:#1e3c72;">
                  <strong>${escapeHtml(a.actor_name || a.actor_email)}</strong>
                  <br><small style="color:#53657d;">${escapeHtml(a.actor_email)} · ${escapeHtml(a.actor_role)}</small>
                </td>
                <td style="padding:6px; color:#1e3c72;">${escapeHtml(a.action)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div style="color:#888;">Unable to load activity.</div>`;
  }
}

function renderSettingsAccount() {
  const container = document.getElementById("settingsTabAccount");
  if (!container) return;
  if (!currentUser) return;
  container.innerHTML = `
    <div style="margin-bottom:12px;">
      <strong>Account</strong>
    </div>
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:14px; font-size:0.92rem; color:#1e3c72;">
      <div style="margin-bottom:6px;"><strong>Name:</strong> ${escapeHtml(currentUser.name || "")}</div>
      <div style="margin-bottom:6px;"><strong>Email:</strong> ${escapeHtml(currentUser.email || "")}</div>
      <div style="margin-bottom:12px;"><strong>Role:</strong> ${currentUser.role === "admin" ? "Admin" : "Normal User"}</div>
      <button id="logoutBtn" style="padding:10px 16px; border-radius:8px; border:none; background:#4a5568; color:#fff; cursor:pointer; font-weight:600;">Log out</button>
    </div>
  `;
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);
}

function setupSettingsModal() {
  const openBtn = document.getElementById("settingsBtn");
  if (openBtn) openBtn.addEventListener("click", openSettingsModal);
  const closeBtn = document.getElementById("closeSettingsBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeSettingsModal);
  const modal = document.getElementById("settingsModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeSettingsModal();
    });
    modal.querySelectorAll(".settings-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        modal.querySelectorAll(".settings-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const name = tab.dataset.tab;
        const panels = {
          tags: "settingsTabTags",
          users: "settingsTabUsers",
          activity: "settingsTabActivity",
          account: "settingsTabAccount"
        };
        Object.entries(panels).forEach(([key, id]) => {
          const el = document.getElementById(id);
          if (el) el.style.display = key === name ? "block" : "none";
        });
      });
    });
  }
}

// ============================================================================
// CLIENT PANEL ACTION BUTTONS (delegated)
// ============================================================================
function setupClientActionButtons() {
  document.addEventListener("click", async (e) => {
    const target = e.target.closest("button");
    if (!target) return;

    if (target.id === "saveClientBtn") {
      await saveClientContact();
    } else if (target.id === "deleteClientBtn") {
      if (!activeId) return;
      if (confirm("Permanently delete this client and all of its jobs?")) {
        try {
          await window.api.deleteClient(activeId);
          await refreshList();
          closePanel();
          showToast("Client deleted", "success");
          refreshNotificationBadge();
        } catch (err) {
          console.error(err);
          showToast("Failed to delete client", "error");
        }
      }
    } else if (target.id === "printClientBtn") {
      printClientWorkspace();
    } else if (target.id === "closeClientBtn") {
      await saveClientContact();
      closePanel();
    } else if (target.id === "reviewClientBtn") {
      window.open("https://www.google.com/maps/place/DeVries+Brothers+Roofing+and+Construction/@36.9772676,-86.4834052,12z/data=!4m8!3m7!1s0xa03088fa81602de1:0x9f671e0d27f600cb!8m2!3d36.977159!4d-86.4008325!9m1!1b1!16s%2Fg%2F11x90mpwmq?entry=ttu&g_ep=EgoyMDI2MDIxOC4wIKXMDSoASAFQAw%3D%3D", "_blank");
    } else if (target.classList.contains("client-primary-tag-chip")) {
      const tagId = Number(target.dataset.clientTagId);
      if (tagId) {
        closePanel();
        await toggleClientTagFilter(tagId);
      }
    } else if (target.dataset.clearClientFilter) {
      await toggleClientTagFilter(activeClientTagFilter);
    }
  });

  // Primary client tag assignment (admin) — delegated so the chip can be
  // re-rendered in place without losing its change handler.
  document.addEventListener("change", async (e) => {
    const sel = e.target;
    if (!sel || sel.id !== "clientPrimaryTag") return;
    try {
      const value = sel.value;
      const chosen = sel.selectedOptions && sel.selectedOptions[0];
      const chosenName = chosen && chosen.value ? chosen.textContent.trim() : null;
      await window.api.setClientPrimaryTag(activeId, value || null);
      if (activeClient) {
        activeClient.primary_tag_id = value || null;
        activeClient.primary_tag_name = chosenName;
      }
      updatePrimaryTagChip();
      showToast("Primary tag saved", "success");
      await refreshList();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to set primary tag", "error");
    }
  });
}

// ============================================================================
// INIT
// ============================================================================
(async function initV3() {
  try {
    const user = await initSession();
    setupSettingsModal();
    setupNotifications();
    setupClientActionButtons();
    setupDashboardView();
    await loadTagFilterBar();
    await loadClientTagFilterBar();
    await setupSalesFilter();
    await refreshList();

    // Deep links: /main?job=<id> or /main?client=<id>
    if (user) {
      const params = new URLSearchParams(window.location.search);
      const jobId = Number(params.get("job"));
      const clientId = Number(params.get("client"));
      if (Number.isInteger(jobId) && jobId > 0) {
        await openJob(jobId);
      } else if (Number.isInteger(clientId) && clientId > 0) {
        await openClient(clientId);
      }
    }
  } catch (err) {
    console.error("initV3 failed:", err);
  }
})();
