 // ======================================================
// STATUS CONFIG
// ======================================================
const STATUS_ORDER = [
  "Prospect",
  "Approved",
  "Completed",
  "Invoice",
  "Closed"
];

const STATUS_COLORS = {
  Prospect: "#a780ee",
  Approved: "#6dddef",
  Completed: "#f0ad4e",
  Invoice: "#dfa575",
  Closed: "#aa1b1b"
};

// ======================================================
// PRINT STYLE
// ======================================================
(function injectPrintStyle() {
  const style = document.createElement("style");
  style.innerHTML = `
  @media print {
    @page {
      margin: 0.5in;
    }

    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      color: #000 !important;
      min-height: auto !important;
    }

    #Main_header,
    .sidebar,
    #toastContainer,
    #pdfModal,
    #projectOverlay {
      display: none !important;
    }

    .crm-dashboard,
    .main-content {
      display: block !important;
      width: 100% !important;
      background: #fff !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: visible !important;
    }

    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    #projectPanel {
      display: block !important;
      position: static;
      left: 0;
      top: 0;
      width: 100%;
      max-width: none !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      transform: none !important;
      box-shadow: none !important;
      background: white !important;
      color: black !important;
    }

    #projectPanel .detail-card {
      box-shadow: none !important;
      background: white !important;
      color: black !important;
      opacity: 1 !important;
      transform: none !important;
    }

    .notes-list {
      max-height: none !important;
      overflow: visible !important;
    }

    #closeBtn,
    #saveBtn,
    #delBtn,
    #printBtn,
    #reviewBtn,
    #undoFinanceBtn,
    #pdf-drop-zone,
    #pdf-upload-btn {
      display: none !important;
    }

    a {
      color: black !important;
      text-decoration: none !important;
    }
  }`;
  document.head.appendChild(style);
})();

// ======================================================
// API WRAPPER
// ======================================================
window.api = {
  async searchClients(term = '') {
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
    if (!res.ok) throw new Error("Search failed");
    return res.json();
  },

  async saveClient(client) {
    const name = `${client.fName || ''} ${client.lName || ''}`.trim();
    const res = await fetch('/api/save-client', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...client, name })
    });
    if (!res.ok) throw new Error("Save failed");
    return res.json();
  },

  async updateProject(data) {
    if (data.fName || data.lName) {
      data.name = `${data.fName || ''} ${data.lName || ''}`.trim();
    }
    const res = await fetch('/api/update-project', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("Update failed");
    return res.json();
  },

  async deleteClient(id) {
    const res = await fetch('/api/delete-client', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!res.ok) throw new Error("Delete failed");
    return res.json();
  },

  async uploadPDFs(files, clientId) {
    const formData = new FormData();
    files.forEach(file => formData.append("files", file));
    const res = await fetch(`/api/pdf/upload/${clientId}`, {
      method: "POST",
      body: formData
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  async listPDFs(clientId) {
    const res = await fetch(`/api/pdf/list/${clientId}`);
    if (!res.ok) throw new Error("List PDFs failed");
    return res.json();
  },

  async deletePDF(clientId, fileName) {
    const res = await fetch(`/api/pdf/delete/${clientId}/${encodeURIComponent(fileName)}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Delete failed");
    return res.json();
  },

  async updateTotal(clientId, total_due) {
    const res = await fetch(`/api/clients/${clientId}/total`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_due })
    });
    if (!res.ok) throw new Error("Total update failed");
    return res.json();
  },

  async addPayment(clientId, payment) {
    const res = await fetch(`/api/clients/${clientId}/payment`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment })
    });
    if (!res.ok) throw new Error("Payment failed");
    return res.json();
  },

  async resetAmountPaid(clientId) {
    const res = await fetch(`/api/clients/${clientId}/reset-paid`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) throw new Error("Reset failed");
    return res.json();
  },

  async restoreFinanceState(clientId, state) {
    const res = await fetch(`/api/clients/${clientId}/finance-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    if (!res.ok) throw new Error("Restore failed");
    return res.json();
  },



  // ==========================
  // NOTES API
  // ==========================
  async listNotes(clientId) {
    const res = await fetch(`/api/notes/list/${clientId}`);
    if (!res.ok) throw new Error("Failed to list notes");
    return res.json();
  },

  async addNote(clientId, content) {
    clientId = Number(clientId);
    const res = await fetch(`/api/notes/add/${clientId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: content })
    });
    if (!res.ok) throw new Error("Failed to add note");
    return res.json();
  },

  async updateNote(clientId, noteId, content) {
    const res = await fetch(`/api/notes/update/${clientId}/${noteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: content })
    });
    if (!res.ok) throw new Error("Failed to update note");
    return res.json();
  },

  async deleteNote(clientId, noteId) {
    clientId = Number(clientId);
    const res = await fetch(`/api/notes/delete/${clientId}/${noteId}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Failed to delete note");
    return res.json();
  }
};
// ======================================================
// UPDATE FINANCE PAGE WHEN CLIENT TOTAL OR PAYMENT CHANGES
// ======================================================
function triggerFinanceUpdate() {
  // Dispatch a custom event for any finance listeners
  document.dispatchEvent(new Event('financeUpdated'));
}
// ======================================================
// FINANCE UNDO STACK (GLOBAL)
// ======================================================
let financeUndoStack = [];

// ======================================================
// DOM REFERENCES
// ======================================================
const clientList = document.getElementById("clientList");
const projectPanel = document.getElementById("projectPanel");
const searchInput = document.getElementById("searchClients");
const intakeFormEl = document.getElementById("clientIntakeForm");
const overlay = document.getElementById("projectOverlay");
// Keep overlay only as a backdrop layer; do not close modal on backdrop click.
// Client panel should close via explicit actions (X button / Delete flow).

let activeId = null;
let searchTimeout = null;
let isSaving = false;
let queuedSave = false;
let lastSearchTerm = "";
let selectedIndex = -1;
let sidebarAllClients = [];
let sidebarSearchTerm = "";
let sidebarRenderCount = 0;
const sidebarChunkSize = 60;
let sidebarListContainer = null;
let newNoteSaving = false;

function isCenteredSidebarLayout() {
  const dashboard = document.querySelector(".crm-dashboard");
  if (!dashboard) return false;
  return window.getComputedStyle(dashboard).flexDirection === "column";
}

function shouldUseMobileSidebarSwitch() {
  return window.innerWidth <= 768;
}

// ======================================================
// SEARCH
// ======================================================
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
    lastSearchTerm = term;
    clearTimeout(searchTimeout);

    searchTimeout = setTimeout(async () => {
      try {
        const allClients = await window.api.searchClients("");
        const matchedStatus = STATUS_ORDER.find(
          s => s.toLowerCase() === term
        );

        if (matchedStatus) {
          renderSidebar(
            allClients.filter(c =>
              (c.status || "Lead").toLowerCase() === term
            ),
            term
          );
          return;
        }

        const filtered = await window.api.searchClients(term);
        renderSidebar(filtered, term);

      } catch (err) {
        console.error(err);
      }
    }, 300);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
    const items = Array.from(document.querySelectorAll(".client-card"));
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
    }

    items.forEach((item, idx) => {
      item.classList.toggle("kb-selected", idx === selectedIndex);
      if (idx === selectedIndex) item.scrollIntoView({ block: "nearest" });
    });

    if (e.key === "Enter" && selectedIndex >= 0) {
      const id = parseInt(items[selectedIndex].dataset.id);
      if (!Number.isNaN(id)) openClient(id);
    }
  });
}

// ======================================================
// ADD CLIENT
// ======================================================
if (intakeFormEl) {
  const fNameInput = document.getElementById("fName");
  const lNameInput = document.getElementById("lName");

  if (fNameInput) fNameInput.style.borderLeft = "4px solid #007bff";
  if (lNameInput) lNameInput.style.borderLeft = "4px solid #28a745";

  intakeFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();

    const client = {
      fName: fNameInput?.value || "",
      lName: lNameInput?.value || "",
      email: document.getElementById("email")?.value || "",
      phone: document.getElementById("phone")?.value || "",
      address: document.getElementById("address")?.value || "",
      status: "Lead"
    };

    try {
      await window.api.saveClient(client);
      await refreshList();
      e.target.reset();
      showToast("Client added", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to add client", "error");
    }
  });
}

// ======================================================
// SIDEBAR
// ======================================================
async function refreshList() {
  try {
    if (clientList) {
      clientList.innerHTML = `<li class="loading-state">Loading clients...</li>`;
    }
    const clients = await window.api.searchClients("");
    if (!clients || clients.length === 0) {
      clientList.innerHTML = `<li class="empty-state">No clients found.</li>`;
      return;
    }
    renderSidebar(clients);
  } catch (err) {
    console.error(err);
    if (clientList) {
      clientList.innerHTML =
        `<li class="empty-state">Unable to load clients. Check server connection and refresh.</li>`;
    }
  }
}

function renderSidebar(list = [], term = "") {
  if (!clientList) return;

  list.sort((a, b) =>
    STATUS_ORDER.indexOf(a.status || "Lead") -
    STATUS_ORDER.indexOf(b.status || "Lead")
  );

  const counts = {};
  STATUS_ORDER.forEach(s => counts[s] = 0);
  list.forEach(c => counts[c.status || "Lead"]++);

  const countsHTML = `
    <li class="status-counts" style="list-style:none; padding:0; margin:0 0 8px 0;">
      ${STATUS_ORDER.map(s =>
        `<div style="color:${STATUS_COLORS[s] || "#007bff"}">
          ${s}: ${counts[s]}
        </div>`
      ).join("")}
    </li>
  `;

  sidebarAllClients = list;
  sidebarSearchTerm = term;
  sidebarRenderCount = 0;

  clientList.innerHTML =
    countsHTML +
    `<li id="clientListItems" style="list-style:none; padding:0; margin:0;"></li>`;
  sidebarListContainer = document.getElementById("clientListItems");
  renderSidebarChunk();

  selectedIndex = -1;
}

function buildClientCard(c, term = "") {
  const [fName, ...rest] = (c.name || "").split(" ");
  const lName = rest.join(" ");
  const color = STATUS_COLORS[c.status] || "#007bff";
  const displayName = `${fName || ""} ${lName || ""}`.trim();
  const displayPhone = c.phone || "";
  const safeTerm = term ? term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const nameHighlighted = safeTerm
    ? displayName.replace(new RegExp(safeTerm, "ig"), (m) => `<mark>${m}</mark>`)
    : displayName;
  const phoneHighlighted = safeTerm
    ? displayPhone.replace(new RegExp(safeTerm, "ig"), (m) => `<mark>${m}</mark>`)
    : displayPhone;

  return `
    <div class="client-card" data-id="${c.id}" data-name="${displayName}" style="border-left:4px solid ${color};">
      <div class="client-name">
        ${nameHighlighted}
      </div>

      <div class="client-meta">
        📞 ${phoneHighlighted}
      </div>

      <div class="client-status" style="color:${color};">
        ${c.status || "Lead"}
      </div>
    </div>
  `;
}

function renderSidebarChunk() {
  if (!sidebarListContainer) return;
  if (sidebarRenderCount >= sidebarAllClients.length) return;

  const next = sidebarAllClients.slice(
    sidebarRenderCount,
    sidebarRenderCount + sidebarChunkSize
  );
  sidebarRenderCount += next.length;

  const html = next.map(c => buildClientCard(c, sidebarSearchTerm)).join("");
  sidebarListContainer.insertAdjacentHTML("beforeend", html);
}

// ======================================================
// OPEN CLIENT PANEL
// ======================================================
async function openClient(id) {
  if (!id) return;
  activeId = id;
  try {
    const clients = await window.api.searchClients("");
    const client = clients.find(c => c.id == id);
    if (!client) return;

    const [fName, ...rest] = (client.name || "").split(" ");
    const lName = rest.join(" ");
    const mapsLink = client.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`
      : "";

    projectPanel.innerHTML = `
      <div class="detail-card animate-panel" style="opacity:0; transform:translateY(-20px); transition:0.25s ease;">
        <button id="closeBtn" class="close-x">&times;</button>
        <header class="detail-header">
          <h2>${fName || ""} ${lName || ""}</h2>
          <div class="contact-quick-links">
            <span>📞 <a href="tel:${client.phone || ""}">${client.phone || ""}</a></span>
            <span style="margin-left:20px;">✉️ <a href="mailto:${client.email || ""}">${client.email || ""}</a></span>
          </div>
          <span id="saveStatus" style="margin-left:auto; font-size:12px; color:#9ad0ff;">Saved</span>
        </header>

        <div class="roofing-grid">
          <div style="grid-column: span 2;">
            <label>Job Status</label>
            <select id="p-status">
              ${STATUS_ORDER.map(s =>
                `<option value="${s}" ${client.status === s ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
          </div>

          <label>Job Address</label>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <input type="text" id="p-address" value="${client.address || ""}">
            ${client.address
              ? `<a href="${mapsLink}" target="_blank" style="color:#007bff; font-size:0.9rem;">📍 Open in Google Maps</a>`
              : ""}
          </div>

          <label>Phone Number</label>
          <input type="tel" id="p-phone" value="${client.phone || ""}">

          <label>Email Address</label>
          <input type="email" id="p-email" value="${client.email || ""}">

          <div style="grid-column: span 2; border-top:1px solid #ddd; padding-top:15px; margin-top:10px;">
            <h3 style="margin-bottom:10px;">Financial Overview</h3>

            <div style="display:flex; gap:10px; margin-bottom:10px;">
              <input type="text" id="totalDueInput" placeholder="Total Due"
                inputmode="decimal" style="flex:1;" value="${formatMoney(client.total_due || 0)}">
              <button id="saveTotalBtn" class="btn-primary" style="background:#17a2b8;">Save</button>
            </div>

            <div style="display:flex; justify-content:space-between; font-size:14px;">
              <div>Amount Paid:
                <strong id="amountPaidDisplay">$${formatMoney(client.amount_paid || 0)}</strong>
              </div>
              <div>Balance:
                <strong id="balanceDisplay">$${formatMoney(client.balance || 0)}</strong>
              </div>
            </div>

            <div style="display:flex; gap:10px; margin-top:10px;">
              <input type="text" id="paymentInput" placeholder="Add Payment"
                inputmode="decimal" style="flex:1;">
              <button id="addPaymentBtn" class="btn-primary" style="background:#28a745;">Add Payment</button>
              <button id="undoFinanceBtn" class="btn-primary" style="background:#dc3545;">Undo Payment</button>
            </div>
          </div>

          <div id="pdf-drop-zone" class="drop-zone"
            style="grid-column: span 2;">📄 Drop Client PDFs Here</div>

          <button id="pdf-upload-btn"
            style="grid-column: span 2; margin-top:8px; background:#2c3e50; color:white; border:none; padding:8px; border-radius:6px; cursor:pointer;">
            Upload PDF</button>

          <input type="file"
            id="pdf-file-input"
            accept="application/pdf"
            multiple
            hidden />

          <div id="pdf-list"
            style="grid-column: span 2; margin-top:10px;"></div>

          <div id="notes-section" class="notes-section" style="grid-column: span 2;">
            <h3>Client Notes</h3>
            <div id="notes-list" class="notes-list"></div>
            <div class="notes-actions">
              <textarea id="new-note-input" placeholder="Add a note..." rows="6"></textarea>
              <button id="add-note-btn" class="btn-primary add-note-btn" style="background:#007bff;">Add Note</button>
            </div>
          </div>

          <div style="grid-column: span 2; display:flex; gap:10px; margin-top:10px;">
            <button id="reviewBtn" class="btn-primary" style="background:#d32323; flex:2;">Send Google Review</button>
            <button id="saveBtn" class="btn-primary" style="background:#28a745; flex:2;">Save Changes</button>
            <button id="delBtn" class="btn-primary" style="background:#dc3545; flex:1;">Delete</button>
            <button id="printBtn" class="btn-primary" style="background:#343a40; flex:1;">Print</button>
          </div>

        </div>
      </div>
    `;

    requestAnimationFrame(() => {
      const panel = projectPanel.querySelector(".animate-panel");
      if (panel) {
        panel.style.opacity = 1;
        panel.style.transform = "translateY(0)";
      }
    });


    setupDropZone();
    setupPDFUploadButton();
    loadPDFs(id);
    setupFinancialSection(client);
    setupNotesSection(id);
    setupDirtyTracking();
    setSaveStatus("saved");
    // SHOW MODAL
    projectPanel.style.display = "block";
    if (overlay) overlay.style.display = "none";
    // ==============================
    // MOBILE VIEW SWITCH
    // ==============================
    if (shouldUseMobileSidebarSwitch()) {
      const sidebar = document.querySelector(".sidebar");
      const mainContent = document.querySelector(".main-content");

  if (sidebar) sidebar.classList.add("mobile-hidden");
  if (mainContent) mainContent.classList.add("mobile-full");
}

  } catch (err) {
    console.error(err);
  }
}


// ======================================================
// FINANCIAL SECTION
// ======================================================
function setupFinancialSection(client) {
  const saveTotalBtn = document.getElementById("saveTotalBtn");
  const addPaymentBtn = document.getElementById("addPaymentBtn");
  const totalDueInput = document.getElementById("totalDueInput");
  const paymentInput = document.getElementById("paymentInput");

  applyMoneyInputBehavior(totalDueInput);
  applyMoneyInputBehavior(paymentInput);

  // ==============================
  // SAVE TOTAL
  // ==============================
  saveTotalBtn.onclick = async () => {
    try {
      const newTotal = parseMoney(totalDueInput?.value) || 0;

      // 🧠 Save PREVIOUS state to undo stack
      financeUndoStack.push({
        clientId: activeId,
        total_due: client.total_due,
        amount_paid: client.amount_paid,
        balance: client.balance
      });

      await window.api.updateTotal(activeId, newTotal);

      await refreshList();
      await openClient(activeId);

      triggerFinanceUpdate();

      showToast("Total updated", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to update total", "error");
    }
  };

  // ==============================
  // ADD PAYMENT
  // ==============================
  addPaymentBtn.onclick = async () => {
    try {
      const payment = parseMoney(paymentInput?.value) || 0;
      if (payment <= 0) {
        showToast("Enter a valid payment", "error");
        return;
      }

      // 🧠 Save PREVIOUS state to undo stack
      financeUndoStack.push({
        clientId: activeId,
        total_due: client.total_due,
        amount_paid: client.amount_paid,
        balance: client.balance
      });

      await window.api.addPayment(activeId, payment);

      await refreshList();
      await openClient(activeId);

      triggerFinanceUpdate();

      showToast("Payment added", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to add payment", "error");
    }
  };
}


// ======================================================
// SAVE STATUS UI
// ======================================================
function setSaveStatus(state) {
  const el = document.getElementById("saveStatus");
  if (!el) return;

  if (state === "saving") {
    el.textContent = "Saving…";
    el.style.color = "#ffd37a";
    return;
  }

  if (state === "error") {
    el.textContent = "Save failed";
    el.style.color = "#ff9aa2";
    return;
  }

  if (state === "unsaved") {
    el.textContent = "Unsaved changes";
    el.style.color = "#ffcc66";
    return;
  }

  el.textContent = "Saved";
  el.style.color = "#9ad0ff";
}

function markDirty() {
  setSaveStatus("unsaved");
}

function setupDirtyTracking() {
  const statusEl = document.getElementById("p-status");
  const addrEl = document.getElementById("p-address");
  const phoneEl = document.getElementById("p-phone");
  const emailEl = document.getElementById("p-email");
  const totalDueEl = document.getElementById("totalDueInput");
  const newNoteInput = document.getElementById("new-note-input");

  [statusEl, addrEl, phoneEl, emailEl, totalDueEl, newNoteInput].forEach(el => {
    if (!el) return;
    el.addEventListener("input", markDirty);
    el.addEventListener("change", markDirty);
  });
}

// ======================================================
// NOTES SECTION
// ======================================================
async function setupNotesSection(clientId) {
  const notesList = document.getElementById("notes-list");
  const newNoteInput = document.getElementById("new-note-input");
  const addNoteBtn = document.getElementById("add-note-btn");
  if (!notesList || !newNoteInput || !addNoteBtn) return;

  clientId = Number(clientId);

  async function loadNotes() {
    notesList.innerHTML = "";

    try {
      const data = await window.api.listNotes(clientId);
      if (!data.notes || data.notes.length === 0) {
        notesList.innerHTML = `<div style="color:#888; font-size:13px;">No notes yet.</div>`;
        return;
      }

      data.notes.forEach(note => {
        const noteDiv = document.createElement("div");
        noteDiv.style.display = "flex";
        noteDiv.style.justifyContent = "space-between";
        noteDiv.style.alignItems = "center";
        noteDiv.style.background = "#f5f5f5";
        noteDiv.style.padding = "6px 10px";
        noteDiv.style.borderRadius = "6px";

        const contentDiv = document.createElement("div");
        contentDiv.innerText = note.content || "";
        contentDiv.style.flex = "1";
        contentDiv.style.marginRight = "6px";
        contentDiv.style.color = "#000";
        contentDiv.style.whiteSpace = "pre-wrap";
        contentDiv.style.wordBreak = "break-word";

        const editBtn = document.createElement("button");
        editBtn.innerText = "Edit";
        editBtn.style.background = "#ffc107";
        editBtn.style.border = "none";
        editBtn.style.padding = "4px 8px";
        editBtn.style.borderRadius = "4px";
        editBtn.style.cursor = "pointer";

        const deleteBtn = document.createElement("button");
        deleteBtn.innerText = "Delete";
        deleteBtn.style.background = "#dc3545";
        deleteBtn.style.border = "none";
        deleteBtn.style.padding = "4px 8px";
        deleteBtn.style.borderRadius = "4px";
        deleteBtn.style.cursor = "pointer";

        editBtn.onclick = async () => {
          const current = note.content || "";
          const textarea = document.createElement("textarea");
          textarea.value = current;
          textarea.rows = 4;
          textarea.style.flex = "1";
          textarea.style.padding = "6px 8px";
          textarea.style.resize = "vertical";
          textarea.dataset.noteId = note.id;
          textarea.dataset.clientId = clientId;
          textarea.dataset.original = current;

          const saveBtn = document.createElement("button");
          saveBtn.innerText = "Save";
          saveBtn.style.background = "#28a745";
          saveBtn.style.border = "none";
          saveBtn.style.padding = "4px 8px";
          saveBtn.style.borderRadius = "4px";
          saveBtn.style.cursor = "pointer";
          saveBtn.style.marginLeft = "6px";

          const cancelBtn = document.createElement("button");
          cancelBtn.innerText = "Cancel";
          cancelBtn.style.background = "#6c757d";
          cancelBtn.style.border = "none";
          cancelBtn.style.padding = "4px 8px";
          cancelBtn.style.borderRadius = "4px";
          cancelBtn.style.cursor = "pointer";
          cancelBtn.style.marginLeft = "6px";

          noteDiv.replaceChild(textarea, contentDiv);
          noteDiv.insertBefore(saveBtn, editBtn);
          noteDiv.insertBefore(cancelBtn, editBtn);
          editBtn.style.display = "none";
        textarea.addEventListener("input", markDirty);

          cancelBtn.onclick = () => loadNotes();
          saveBtn.onclick = async () => {
            const trimmed = textarea.value.trim();
            if (!trimmed) { showToast("Note cannot be empty", "error"); return; }
            try {
              await window.api.updateNote(clientId, note.id, trimmed);
              loadNotes();
            } catch (err) {
              console.error(err);
              showToast("Failed to update note", "error");
            }
          };
        };

        deleteBtn.onclick = async () => {
          if (!confirm("Delete this note?")) return;
          try {
            setSaveStatus("saving");
            await window.api.deleteNote(clientId, note.id);
            loadNotes();
            setSaveStatus("saved");
          } catch (err) {
            console.error(err);
            showToast("Failed to delete note", "error");
          }
        };

        noteDiv.appendChild(contentDiv);
        noteDiv.appendChild(editBtn);
        noteDiv.appendChild(deleteBtn);
        notesList.appendChild(noteDiv);
      });
    } catch (err) {
      console.error(err);
    }
  }


  async function addNoteFromInput({ silent = false } = {}) {
    if (newNoteSaving) return;
    const content = newNoteInput.value.trim();
    if (!content) return;
    newNoteSaving = true;
    try {
      setSaveStatus("saving");
      await window.api.addNote(clientId, content);
      newNoteInput.value = "";
      loadNotes();
      setSaveStatus("saved");
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
      if (!silent) showToast("Failed to add note", "error");
    } finally {
      newNoteSaving = false;
    }
  }

  addNoteBtn.onclick = async () => {
    const content = newNoteInput.value.trim();
    if (!content) { showToast("Cannot add empty note", "error"); return; }
    await addNoteFromInput({ silent: false });
  };

  newNoteInput.addEventListener("input", markDirty);

  loadNotes();
}

// ======================================================
// PDF UPLOAD BUTTON
// ======================================================
function setupPDFUploadButton() {
  const uploadBtn = document.getElementById("pdf-upload-btn");
  const fileInput = document.getElementById("pdf-file-input");
  if (!uploadBtn || !fileInput) return;

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !activeId) return;

    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = "Uploading...";
    uploadBtn.disabled = true;

    try {
      await window.api.uploadPDFs(files, activeId);
      showToast("Upload complete", "success");
      loadPDFs(activeId);
    } catch (err) {
      console.error(err);
      showToast("Upload failed", "error");
    } finally {
      uploadBtn.textContent = originalText;
      uploadBtn.disabled = false;
      fileInput.value = "";
    }
  });
}

// ======================================================
// PDF DISPLAY
// ======================================================
async function loadPDFs(clientId) {
  const container = document.getElementById("pdf-list");
  if (!container) return;

  container.innerHTML = "";
  try {
    const data = await window.api.listPDFs(clientId);
    if (!data.files || data.files.length === 0) {
      container.innerHTML = `<div style="color:#888; font-size:13px;">No PDFs uploaded yet.</div>`;
      return;
    }

    data.files.forEach(file => {
      const card = document.createElement("div");
      card.style.display = "flex";
      card.style.justifyContent = "space-between";
      card.style.alignItems = "center";
      card.style.background = "linear-gradient(135deg, #4a7899, #010101)";
      card.style.padding = "10px 14px";
      card.style.borderRadius = "8px";
      card.style.marginBottom = "8px";
      card.style.border = "1px solid #007bff";
      card.style.boxShadow = "0 4px 10px rgba(0,0,0,0.08)";
      card.style.transition = "0.2s ease";

      card.addEventListener("mouseenter", () => {
        card.style.transform = "translateY(-2px)";
        card.style.boxShadow = "0 6px 14px rgba(0,0,0,0.12)";
      });

      card.addEventListener("mouseleave", () => {
        card.style.transform = "translateY(0)";
        card.style.boxShadow = "0 4px 10px rgba(0,0,0,0.08)";
      });

      const name = document.createElement("div");
      name.innerHTML = `📄 ${file.name}`;
      name.style.fontWeight = "600";
      name.style.fontSize = "14px";

      const btnGroup = document.createElement("div");
      btnGroup.style.display = "flex";
      btnGroup.style.gap = "6px";

      const openBtn = document.createElement("a");
      openBtn.href = file.url;
      openBtn.target = "_blank";
      openBtn.innerText = "Open";
      openBtn.style.background = "#007bff";
      openBtn.style.color = "white";
      openBtn.style.padding = "5px 12px";
      openBtn.style.borderRadius = "6px";
      openBtn.style.fontSize = "12px";
      openBtn.style.textDecoration = "none";

      const deleteBtn = document.createElement("button");
      deleteBtn.innerText = "Delete";
      deleteBtn.style.background = "#dc3545";
      deleteBtn.style.color = "white";
      deleteBtn.style.border = "none";
      deleteBtn.style.padding = "5px 12px";
      deleteBtn.style.borderRadius = "6px";
      deleteBtn.style.fontSize = "12px";
      deleteBtn.style.cursor = "pointer";

      deleteBtn.onclick = async () => {
        if (!confirm("Delete this PDF permanently?")) return;
        try {
          await window.api.deletePDF(clientId, file.name);
          loadPDFs(clientId);
        } catch (err) {
          console.error(err);
          showToast("Failed to delete file", "error");
        }
      };

      btnGroup.appendChild(openBtn);
      btnGroup.appendChild(deleteBtn);
      card.appendChild(name);
      card.appendChild(btnGroup);
      container.appendChild(card);
    });

  } catch (err) {
    console.error(err);
  }
}

// ======================================================
// DRAG & DROP
// ======================================================
function setupDropZone() {
  const dz = document.getElementById("pdf-drop-zone");
  if (!dz) return;

  ["dragover", "dragleave", "drop"].forEach(evt =>
    dz.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
    })
  );

  dz.addEventListener("drop", async (e) => {
    const files = Array.from(e.dataTransfer.files);
    if (!files.length || !activeId) return;

    const original = dz.textContent;
    dz.textContent = "Uploading...";
    try {
      await window.api.uploadPDFs(files, activeId);
      showToast("Upload complete", "success");
      loadPDFs(activeId);
    } catch (err) {
      console.error(err);
      showToast("Upload failed", "error");
    } finally {
      dz.textContent = original;
    }
  });
}

// ======================================================
// PANEL BUTTON HANDLER
// ======================================================
if (projectPanel) {
  projectPanel.addEventListener("click", async (e) => {
    const target = e.target;

    // ==============================
// UNDO FINANCIAL CHANGE
// ==============================
if (target.id === "undoFinanceBtn") {
  if (financeUndoStack.length === 0) {
    showToast("Nothing to undo", "info");
    return;
  }

  if (!confirm("Undo the last payment/total change?")) return;

  const last = financeUndoStack.pop();

  try {
    await window.api.restoreFinanceState(last.clientId, {
      total_due: last.total_due,
      amount_paid: last.amount_paid,
      balance: last.balance
    });

    await refreshList();
    await openClient(last.clientId);

    triggerFinanceUpdate();

    showToast("Undo complete", "success");
  } catch (err) {
    console.error(err);
    showToast("Undo failed", "error");
  }

  return;
}

    if (target.id === "printBtn") window.print();

    if (target.id === "reviewBtn") {
      const googleLink = "https://www.google.com/maps/place/DeVries+Brothers+Roofing+and+Construction/@36.9772676,-86.4834052,12z/data=!4m8!3m7!1s0xa03088fa81602de1:0x9f671e0d27f600cb!8m2!3d36.977159!4d-86.4008325!9m1!1b1!16s%2Fg%2F11x90mpwmq?entry=ttu&g_ep=EgoyMDI2MDIxOC4wIKXMDSoASAFQAw%3D%3D";
      window.open(googleLink, "_blank");
    }

    if (target.id === "saveBtn") {
      await savePanelChanges({ silent: false, force: true });
      openClient(activeId);
    }

    if (target.id === "delBtn") {
      if (confirm("Permanently delete this client?")) {
        await window.api.deleteClient(activeId);
        await refreshList();
        closePanel();
      }
    }

    if (target.id === "closeBtn") {
      await savePanelChanges({ silent: true, force: true });
      closePanel();
    }
  });
}

// ======================================================
// HELPERS
// ======================================================

function showToast(message, type = "info", timeout = 2200) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, timeout);
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseMoney(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}


function applyMoneyInputBehavior(input) {
  if (!input) return;

  const initial = input.value?.trim();
  if (initial) {
    input.value = formatMoney(parseMoney(initial));
  }

  function formatTypingValue(raw) {
    if (!raw) return "";
    const cleaned = String(raw).replace(/[^0-9.]/g, "");
    if (!cleaned) return "";

    const firstDot = cleaned.indexOf(".");
    let integerPart = cleaned;
    let decimalPart = "";
    let hasDot = false;

    if (firstDot >= 0) {
      hasDot = true;
      integerPart = cleaned.slice(0, firstDot);
      decimalPart = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    }

    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
    const displayInteger = normalizedInteger || (hasDot ? "0" : "");
    const formattedInteger = displayInteger
      ? Number(displayInteger).toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "";

    if (hasDot) return `${formattedInteger}.${decimalPart}`;
    return formattedInteger;
  }

  function caretPosFromDigitCount(value, digitCount) {
    if (digitCount <= 0) return 0;
    let count = 0;
    for (let i = 0; i < value.length; i++) {
      if (/\d/.test(value[i])) count++;
      if (count === digitCount) return i + 1;
    }
    return value.length;
  }

  input.addEventListener("input", () => {
    const selectionStart = input.selectionStart ?? input.value.length;
    const beforeCursor = input.value.slice(0, selectionStart);
    const digitsBefore = (beforeCursor.match(/\d/g) || []).length;

    const formatted = formatTypingValue(input.value);
    input.value = formatted;

    const nextPos = caretPosFromDigitCount(formatted, digitsBefore);
    input.setSelectionRange(nextPos, nextPos);
  });

  input.addEventListener("blur", () => {
    const raw = input.value.trim();
    if (!raw) return;
    input.value = formatMoney(parseMoney(raw));
  });
}



async function savePendingNotes({ silent = false } = {}) {
  if (!activeId) return;

  const noteEdits = document.querySelectorAll("textarea[data-note-id]");
  for (const ta of noteEdits) {
    const noteId = ta.dataset.noteId;
    const clientId = ta.dataset.clientId;
    const original = ta.dataset.original || "";
    const trimmed = ta.value.trim();
    if (!noteId || !clientId || !trimmed || trimmed === original) continue;
    try {
      await window.api.updateNote(clientId, noteId, trimmed);
      ta.dataset.original = trimmed;
    } catch (err) {
      console.error(err);
      if (!silent) showToast("Failed to update note", "error");
    }
  }

  const newNoteInput = document.getElementById("new-note-input");
  if (newNoteInput) {
    const content = newNoteInput.value.trim();
    if (content) {
      try {
        await window.api.addNote(activeId, content);
        newNoteInput.value = "";
      } catch (err) {
        console.error(err);
        if (!silent) showToast("Failed to add note", "error");
      }
    }
  }
}

function collectPanelData() {
  return {
    id: activeId,
    fName: getPanelFName(),
    lName: getPanelLName(),
    address: document.getElementById("p-address")?.value || "",
    status: document.getElementById("p-status")?.value || "",
    phone: document.getElementById("p-phone")?.value || "",
    email: document.getElementById("p-email")?.value || ""
  };
}

async function savePanelChanges({ silent = false, force = false } = {}) {
  if (!activeId) return;
  if (isSaving) {
    queuedSave = true;
    return;
  }

  isSaving = true;
  setSaveStatus("saving");
  try {
    await savePendingNotes({ silent: true });

    const data = collectPanelData();
    if (!force && !data) return;

    await window.api.updateProject(data);
    await refreshList();
    await setupNotesSection(activeId);
    setSaveStatus("saved");
    if (!silent) {
      showToast("Saved", "success");
    }
  } catch (err) {
    console.error(err);
    setSaveStatus("error");
    if (!silent) showToast("Save failed", "error");
  } finally {
    isSaving = false;
    if (queuedSave) {
      queuedSave = false;
      savePanelChanges({ silent: true, force: true });
    }
  }
}

function getPanelFName() {
  const h2 = projectPanel.querySelector("h2");
  if (!h2) return "";
  const parts = h2.innerText.trim().split(" ");
  return parts[0] || "";
}

function getPanelLName() {
  const h2 = projectPanel.querySelector("h2");
  if (!h2) return "";
  const parts = h2.innerText.trim().split(" ");
  return parts.slice(1).join(" ") || "";
}

function closePanel() {

  if (overlay) overlay.style.display = "none";

  const panel = projectPanel.querySelector(".animate-panel");
  if (panel) {
    panel.style.opacity = 0;
    panel.style.transform = "translateY(-20px)";
  }

  setTimeout(() => {
    projectPanel.innerHTML = '';
    projectPanel.style.display = "none";
    activeId = null;
  }, 250);

  // RESTORE MOBILE VIEW
  if (shouldUseMobileSidebarSwitch()) {
    const sidebar = document.querySelector(".sidebar");
    const mainContent = document.querySelector(".main-content");

    if (sidebar) sidebar.classList.remove("mobile-hidden");
    if (mainContent) mainContent.classList.remove("mobile-full");
  }
}

// ======================================================
// SIDEBAR CLICK
// ======================================================
if (clientList) {
  clientList.addEventListener("scroll", () => {
    if (!sidebarListContainer) return;
    const nearBottom =
      clientList.scrollTop + clientList.clientHeight >= clientList.scrollHeight - 120;
    if (nearBottom) renderSidebarChunk();
  });

  clientList.addEventListener("click", (e) => {
    const item = e.target.closest(".client-card");
    if (item) openClient(parseInt(item.dataset.id));
  });
}

// ======================================================
// INITIAL LOAD
// ======================================================
document.addEventListener("keydown", async (e) => {
  if (e.key === "Escape" && projectPanel && projectPanel.style.display === "block") {
    await savePanelChanges({ silent: true, force: true });
    closePanel();
  }
});


// Ensure latest edits are sent before leaving the page

refreshList();
