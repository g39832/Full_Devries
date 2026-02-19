// ======================================================
// STATUS CONFIG
// ======================================================
const STATUS_ORDER = [
  "Lead",
  "Prospect",
  "Customer",
  "Completed",
  "Invoice",
  "Closed"
];

const STATUS_COLORS = {
  Lead: "#007bff",
  Prospect: "#6f42c1",
  Customer: "#17a2b8",
  Completed: "#28a745",
  Invoice: "#fd7e14",
  Closed: "#6c757d"
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
    #pdf-drop-zone {
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
  }
};

// ======================================================
// DOM REFERENCES
// ======================================================
const clientList = document.getElementById("clientList");
const projectPanel = document.getElementById("projectPanel");
const searchInput = document.getElementById("searchClients");
const intakeForm = document.getElementById("clientIntakeForm");

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
if (intakeForm) {
  intakeForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const client = {
      fName: document.getElementById("fName")?.value || "",
      lName: document.getElementById("lName")?.value || "",
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
    STATUS_ORDER.indexOf(a.status || "Lead") -
    STATUS_ORDER.indexOf(b.status || "Lead")
  );

  const counts = {};
  STATUS_ORDER.forEach(s => counts[s] = 0);
  list.forEach(c => counts[c.status || "Lead"]++);

  const countsHTML = `
    <div style="padding:10px; border-bottom:1px solid #ddd;">
      ${STATUS_ORDER.map(s =>
        `<div style="font-size:12px; color:${STATUS_COLORS[s]}">
          ${s}: ${counts[s]}
        </div>`).join("")}
    </div>`;

  const clientsHTML = list.map(c => {
    const [fName, lName] = (c.name || "").split(" ");
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
  activeId = id;

  try {
    const clients = await window.api.searchClients("");
    const client = clients.find(c => c.id == id);
    if (!client) return;

    const [fName, lName] = (client.name || "").split(" ");
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
              <button id="saveTotalBtn" class="btn-primary"
                style="background:#17a2b8;">Save</button>
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
              <button id="addPaymentBtn" class="btn-primary"
                style="background:#28a745;">Add Payment</button>
            </div>
          </div>

          <div id="pdf-drop-zone" class="drop-zone"
            style="grid-column: span 2;">📄 Drop Client PDFs Here</div>

          <div id="pdf-list"
            style="grid-column: span 2; margin-top:10px;"></div>

          <div style="grid-column: span 2; display:flex; gap:10px; margin-top:10px;">
            <button id="saveBtn" class="btn-primary"
              style="background:#28a745; flex:2;">Save Changes</button>
            <button id="delBtn" class="btn-primary"
              style="background:#dc3545; flex:1;">Delete</button>
            <button id="printBtn" class="btn-primary"
              style="background:#343a40; flex:1;">Print</button>
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
    loadPDFs(id);
    setupFinancialSection(client);

  } catch (err) {
    console.error(err);
  }
}

// ======================================================
// FINANCIAL SECTION
// ======================================================
function setupFinancialSection(client) {

  document.getElementById("saveTotalBtn").onclick = async () => {
    try {
      const total = parseFloat(document.getElementById("totalDueInput").value) || 0;

      await window.api.updateTotal(activeId, total);

      await refreshList();
      await openClient(activeId);

      alert("✅ Total Due updated!");
    } catch (err) {
      console.error(err);
      alert("❌ Failed to update Total Due.");
    }
  };

  document.getElementById("addPaymentBtn").onclick = async () => {
    try {
      const payment = parseFloat(document.getElementById("paymentInput").value) || 0;

      if (payment <= 0) {
        alert("Enter valid payment amount.");
        return;
      }

      await window.api.addPayment(activeId, payment);

      await refreshList();
      await openClient(activeId);

      alert("✅ Payment added!");
    } catch (err) {
      console.error(err);
      alert("❌ Failed to add payment.");
    }
  };
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
      container.innerHTML =
        `<div style="color:#888; font-size:13px;">
          No PDFs uploaded yet.
        </div>`;
      return;
    }

    data.files.forEach(file => {

      const card = document.createElement("div");
      card.style.display = "flex";
      card.style.justifyContent = "space-between";
      card.style.background = "#f8f9fa";
      card.style.padding = "8px 12px";
      card.style.borderRadius = "6px";
      card.style.marginBottom = "6px";

      const name = document.createElement("div");
      name.innerHTML = `📄 ${file.name}`;
      name.style.fontWeight = "500";

      const openBtn = document.createElement("a");
      openBtn.href = file.url;
      openBtn.target = "_blank";
      openBtn.innerText = "Open";
      openBtn.style.background = "#007bff";
      openBtn.style.color = "white";
      openBtn.style.padding = "4px 10px";
      openBtn.style.borderRadius = "5px";
      openBtn.style.fontSize = "12px";
      openBtn.style.textDecoration = "none";

      card.appendChild(name);
      card.appendChild(openBtn);
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
    const files = e.dataTransfer.files;
    if (!files.length || !activeId) return;

    for (let file of files) {
      await window.api.uploadPDF(file, activeId);
    }

    loadPDFs(activeId);
  });
}

// ======================================================
// PANEL BUTTON HANDLER
// ======================================================
if (projectPanel) {
  projectPanel.addEventListener("click", async (e) => {

    const target = e.target;

    if (target.id === "printBtn")
      window.print();

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

    if (target.id === "closeBtn")
      closePanel();
  });
}

// ======================================================
// HELPERS
// ======================================================
function getPanelFName() {
  const h2 = projectPanel.querySelector("h2");
  return h2 ? h2.innerText.split(" ")[0] : "";
}

function getPanelLName() {
  const h2 = projectPanel.querySelector("h2");
  return h2
    ? h2.innerText.split(" ").slice(1).join(" ")
    : "";
}

function closePanel() {
  const panel = projectPanel.querySelector(".animate-panel");
  if (!panel) return;

  panel.style.opacity = 0;
  panel.style.transform = "translateY(-20px)";

  setTimeout(() => {
    projectPanel.innerHTML =
      '<div class="welcome-screen"><p>Select a client on the left</p></div>';
  }, 250);
}

// ======================================================
// SIDEBAR CLICK
// ======================================================
if (clientList) {
  clientList.addEventListener("click", (e) => {
    const item = e.target.closest(".client-item");
    if (item)
      openClient(parseInt(item.dataset.id));
  });
}

// ======================================================
// INITIAL LOAD
// ======================================================
refreshList();

// ======================================================
// END OF FILE
// ======================================================
