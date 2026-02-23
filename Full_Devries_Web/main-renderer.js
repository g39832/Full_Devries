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
  Closed: "#000000"
};

// ======================================================
// PRINT STYLE
// ======================================================
(function injectPrintStyle() {
  const style = document.createElement("style");
  style.innerHTML = `
  @media print {
    body * { visibility: hidden; }

    #projectPanel, #projectPanel * {
      visibility: visible;
    }

    #projectPanel {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      background: white !important;
      color: black !important;
    }

    #closeBtn,
    #saveBtn,
    #delBtn,
    #printBtn,
    #reviewBtn,
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

  async uploadPDF(file, clientId) {
    const formData = new FormData();
    formData.append("file", file);
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

let activeId = null;
let searchTimeout = null;

// ======================================================
// SEARCH
// ======================================================
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
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
            )
          );
          return;
        }

        const filtered = await window.api.searchClients(term);
        renderSidebar(filtered);

      } catch (err) {
        console.error(err);
      }
    }, 300);
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
      alert("✅ Client added!");
    } catch (err) {
      console.error(err);
      alert("❌ Failed to add client.");
    }
  });
}

// ======================================================
// SIDEBAR
// ======================================================
async function refreshList() {
  try {
    const clients = await window.api.searchClients("");
    renderSidebar(clients);
  } catch (err) {
    console.error(err);
  }
}

function renderSidebar(list = []) {
  if (!clientList) return;

  list.sort((a, b) =>
    STATUS_ORDER.indexOf(a.status || "Lead") - STATUS_ORDER.indexOf(b.status || "Lead")
  );

  const counts = {};
  STATUS_ORDER.forEach(s => counts[s] = 0);
  list.forEach(c => counts[c.status || "Lead"]++);

  const countsHTML = `
    <div style="padding:10px; border-bottom:1px solid #ddd;">
      ${STATUS_ORDER.map(s =>
        `<div style="font-size:12px; color:${STATUS_COLORS[s] || "#007bff"}">
          ${s}: ${counts[s]}
        </div>`).join("")}
    </div>`;

  const clientsHTML = list.map(c => {
    const [fName, ...rest] = (c.name || "").split(" ");
    const lName = rest.join(" ");
    const color = STATUS_COLORS[c.status] || "#007bff";

    return `
      <li class="client-item" data-id="${c.id}" style="border-left:4px solid ${color}; padding-left:8px;">
        <strong>${fName || ""} ${lName || ""}</strong><br>
        <small>${c.phone || ""}</small><br>
        <span style="font-size:11px; color:${color}; font-weight:bold;">${c.status || "Lead"}</span>
      </li>`;
  }).join("");

  clientList.innerHTML = countsHTML + clientsHTML;
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
              <input type="number" id="totalDueInput" placeholder="Total Due" step="0.01"
                style="flex:1;" value="${client.total_due || 0}">
              <button id="saveTotalBtn" class="btn-primary" style="background:#17a2b8;">Save</button>
            </div>

            <div style="display:flex; justify-content:space-between; font-size:14px;">
              <div>Amount Paid:
                <strong id="amountPaidDisplay">$${(client.amount_paid || 0).toFixed(2)}</strong>
              </div>
              <div>Balance:
                <strong id="balanceDisplay">$${(client.balance || 0).toFixed(2)}</strong>
              </div>
            </div>

            <div style="display:flex; gap:10px; margin-top:10px;">
              <input type="number" id="paymentInput" placeholder="Add Payment"
                step="0.01" style="flex:1;">
              <button id="addPaymentBtn" class="btn-primary" style="background:#28a745;">Add Payment</button>
             
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

          <div id="notes-section" style="grid-column: span 2; margin-top:15px; border-top:1px solid #ddd; padding-top:10px;">
            <h3>Client Notes</h3>
            <div id="notes-list" style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;"></div>
            <div style="display:flex; gap:6px;">
              <input type="text" id="new-note-input" placeholder="Add a note..." style="flex:1; padding:4px 6px;">
              <button id="add-note-btn" class="btn-primary" style="background:#007bff;">Add Note</button>
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

  // ==============================
  // SAVE TOTAL
  // ==============================
  saveTotalBtn.onclick = async () => {
    try {
      const newTotal = parseFloat(document.getElementById("totalDueInput").value) || 0;

      // 🧠 Save PREVIOUS state to undo stack
      financeUndoStack.push({
        clientId: activeId,
        total_due: client.total_due,
        amount_paid: client.amount_paid
      });

      await window.api.updateTotal(activeId, newTotal);

      await refreshList();
      await openClient(activeId);

      triggerFinanceUpdate();

      alert("✅ Total Due updated!");
    } catch (err) {
      console.error(err);
      alert("❌ Failed to update Total Due.");
    }
  };

  // ==============================
  // ADD PAYMENT
  // ==============================
  addPaymentBtn.onclick = async () => {
    try {
      const payment = parseFloat(document.getElementById("paymentInput").value) || 0;
      if (payment <= 0) {
        alert("Enter valid payment amount.");
        return;
      }

      // 🧠 Save PREVIOUS state to undo stack
      financeUndoStack.push({
        clientId: activeId,
        total_due: client.total_due,
        amount_paid: client.amount_paid
      });

      await window.api.addPayment(activeId, payment);

      await refreshList();
      await openClient(activeId);

      triggerFinanceUpdate();

      alert("✅ Payment added!");
    } catch (err) {
      console.error(err);
      alert("❌ Failed to add payment.");
    }
  };
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
          const newContent = prompt("Edit note:", contentDiv.innerText);
          if (newContent === null) return;
          const trimmed = newContent.trim();
          if (!trimmed) return alert("Note cannot be empty.");
          try {
            await window.api.updateNote(clientId, note.id, trimmed);
            loadNotes();
          } catch (err) {
            console.error(err);
            alert("❌ Failed to update note.");
          }
        };

        deleteBtn.onclick = async () => {
          if (!confirm("Delete this note?")) return;
          try {
            await window.api.deleteNote(clientId, note.id);
            loadNotes();
          } catch (err) {
            console.error(err);
            alert("❌ Failed to delete note.");
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

  addNoteBtn.onclick = async () => {
    const content = newNoteInput.value.trim();
    if (!content) return alert("Cannot add empty note.");
    try {
      await window.api.addNote(clientId, content);
      newNoteInput.value = "";
      loadNotes();
    } catch (err) {
      console.error(err);
      alert("❌ Failed to add note.");
    }
  };

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

    await Promise.all(files.map(file => window.api.uploadPDF(file, activeId)));

    loadPDFs(activeId);
    fileInput.value = "";
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
          alert("❌ Failed to delete file.");
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
    await Promise.all(files.map(file => window.api.uploadPDF(file, activeId)));
    loadPDFs(activeId);
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
    alert("Nothing to undo!");
    return;
  }

  const last = financeUndoStack.pop();

  try {
    // Reset amount paid completely
    await window.api.resetAmountPaid(last.clientId);

    // Restore total_due
    await window.api.updateTotal(last.clientId, last.total_due);

    // Restore amount_paid
    if (last.amount_paid > 0) {
      await window.api.addPayment(last.clientId, last.amount_paid);
    }

    await refreshList();
    await openClient(last.clientId);

    triggerFinanceUpdate();

    alert("✅ Financial change undone!");
  } catch (err) {
    console.error(err);
    alert("❌ Failed to undo change.");
  }

  return;
}

    if (target.id === "printBtn") window.print();

    if (target.id === "reviewBtn") {
      const googleLink = "https://www.google.com/maps/place/DeVries+Brothers+Roofing+and+Construction/@36.9772676,-86.4834052,12z/data=!4m8!3m7!1s0xa03088fa81602de1:0x9f671e0d27f600cb!8m2!3d36.977159!4d-86.4008325!9m1!1b1!16s%2Fg%2F11x90mpwmq?entry=ttu&g_ep=EgoyMDI2MDIxOC4wIKXMDSoASAFQAw%3D%3D";
      window.open(googleLink, "_blank");
    }

    if (target.id === "saveBtn") {
      const data = {
        id: activeId,
        fName: getPanelFName(),
        lName: getPanelLName(),
        address: document.getElementById("p-address")?.value || "",
        status: document.getElementById("p-status")?.value || "",
        phone: document.getElementById("p-phone")?.value || "",
        email: document.getElementById("p-email")?.value || ""
      };
      await window.api.updateProject(data);
      await refreshList();
      alert("✅ Saved Successfully!");
      openClient(activeId);
    }

    if (target.id === "delBtn") {
      if (confirm("Permanently delete this client?")) {
        await window.api.deleteClient(activeId);
        await refreshList();
        closePanel();
      }
    }

    if (target.id === "closeBtn") closePanel();
  });
}

// ======================================================
// HELPERS
// ======================================================
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
  const panel = projectPanel.querySelector(".animate-panel");
  if (!panel) return;

  panel.style.opacity = 0;
  panel.style.transform = "translateY(-20px)";

  setTimeout(() => {
    projectPanel.innerHTML = '<div class="welcome-screen"><p>Select a client on the left</p></div>';
  }, 250);
}

// ======================================================
// SIDEBAR CLICK
// ======================================================
if (clientList) {
  clientList.addEventListener("click", (e) => {
    const item = e.target.closest(".client-item");
    if (item) openClient(parseInt(item.dataset.id));
  });
}

// ======================================================
// INITIAL LOAD
// ======================================================
refreshList();