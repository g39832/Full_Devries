// =========================
// STATUS CONFIG
// =========================
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

// =========================
// API WRAPPER
// =========================
window.api = {

  searchClients: async (term = '') => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
    if (!res.ok) throw new Error('Search failed');
    return res.json();
  },

  saveClient: async (client) => {
    const name = `${client.fName || ''} ${client.lName || ''}`.trim();
    const res = await fetch('/api/save-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...client, name })
    });
    if (!res.ok) throw new Error('Save failed');
    return res.json();
  },

  updateProject: async (data) => {
    if (data.fName || data.lName) {
      data.name = `${data.fName || ''} ${data.lName || ''}`.trim();
    }

    const res = await fetch('/api/update-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) throw new Error('Update failed');
    return res.json();
  },

  deleteClient: async (id) => {
    const res = await fetch('/api/delete-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });

    if (!res.ok) throw new Error('Delete failed');
    return res.json();
  },

  uploadPDF: async (file, clientId) => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`/api/pdf/upload/${clientId}`, {
      method: "POST",
      body: formData
    });

    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  listPDFs: async (clientId) => {
    const res = await fetch(`/api/pdf/list/${clientId}`);
    if (!res.ok) throw new Error("List PDFs failed");
    return res.json();
  }
};

// =========================
// DOM REFERENCES
// =========================
const clientList = document.getElementById('clientList');
const projectPanel = document.getElementById('projectPanel');
const searchInput = document.getElementById('searchClients');
const intakeForm = document.getElementById('clientIntakeForm');

let activeId = null;
let searchTimeout = null;

// ======================================================
// SEARCH
// ======================================================
searchInput?.addEventListener('input', (e) => {
  const term = e.target.value.trim().toLowerCase();
  clearTimeout(searchTimeout);

  searchTimeout = setTimeout(async () => {
    try {

      const allClients = await window.api.searchClients('');

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

// ======================================================
// ADD CLIENT
// ======================================================
intakeForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const client = {
    fName: document.getElementById('fName')?.value || '',
    lName: document.getElementById('lName')?.value || '',
    email: document.getElementById('email')?.value || '',
    phone: document.getElementById('phone')?.value || '',
    address: document.getElementById('address')?.value || '',
    status: "Lead"
  };

  try {
    await window.api.saveClient(client);
    await refreshList();
    e.target.reset();
    alert("✅ Client added!");
  } catch (err) {
    alert("❌ Failed to add client.");
    console.error(err);
  }
});

// ======================================================
// SIDEBAR
// ======================================================
async function refreshList() {
  const clients = await window.api.searchClients('');
  renderSidebar(clients);
}

function renderSidebar(list) {
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
        </div>`
      ).join('')}
    </div>
  `;

  const clientsHTML = list.map(c => {
    const [fName, lName] = (c.name || '').split(' ');
    const color = STATUS_COLORS[c.status] || "#007bff";

    return `
      <li class="client-item"
          data-id="${c.id}"
          style="border-left:4px solid ${color}; padding-left:8px;">
        <strong>${fName || ''} ${lName || ''}</strong><br>
        <small>${c.phone || ''}</small><br>
        <span style="font-size:11px; color:${color}; font-weight:bold;">
          ${c.status || "Lead"}
        </span>
      </li>
    `;
  }).join('');

  clientList.innerHTML = countsHTML + clientsHTML;
}

// ======================================================
// OPEN CLIENT PANEL
// ======================================================
async function openClient(id) {

  if (activeId === id && document.getElementById('saveBtn')) return;
  activeId = id;

  const clients = await window.api.searchClients('');
  const client = clients.find(c => c.id == id);
  if (!client) return;

  const [fName, lName] = (client.name || '').split(' ');
  const mapsLink = client.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`
    : '';

  projectPanel.innerHTML = `
    <div class="detail-card animate-panel">
      <button id="closeBtn" class="close-x">&times;</button>

      <header class="detail-header">
        <h2>${fName || ''} ${lName || ''}</h2>
        <div class="contact-quick-links">
          <span>📞 <a href="tel:${client.phone}">${client.phone || ''}</a></span>
          <span style="margin-left:20px;">
            ✉️ <a href="mailto:${client.email}">${client.email || ''}</a>
          </span>
        </div>
      </header>

      <div class="roofing-grid">

        <div style="grid-column: span 2;">
          <label>Job Status</label>
          <select id="p-status">
            ${STATUS_ORDER.map(s =>
              `<option value="${s}" ${client.status === s ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </div>

        <label>Job Address</label>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <input type="text" id="p-address" value="${client.address || ''}">
          ${client.address
            ? `<a href="${mapsLink}" target="_blank"
                 style="color:#007bff; font-size:0.9rem;">
                 📍 Open in Google Maps
               </a>`
            : ''}
        </div>

        <label>Phone Number</label>
        <input type="tel" id="p-phone" value="${client.phone || ''}">

        <label>Email Address</label>
        <input type="email" id="p-email" value="${client.email || ''}">

        <div id="pdf-drop-zone"
             class="drop-zone"
             style="grid-column: span 2;">
          📄 Drop Client PDFs Here
        </div>

        <div id="pdf-list"
             style="grid-column: span 2; margin-top:10px;">
        </div>

        <div style="grid-column: span 2; display:flex; gap:10px; margin-top:10px;">
          <button id="saveBtn"
                  class="btn-primary"
                  style="background:#28a745; flex:2;">
            Save Changes
          </button>
          <button id="delBtn"
                  class="btn-primary"
                  style="background:#dc3545; flex:1;">
            Delete
          </button>
        </div>

      </div>
    </div>
  `;

  setupDropZone();
  loadPDFs(id);

  const panel = projectPanel.querySelector('.animate-panel');
  requestAnimationFrame(() => {
    panel.style.opacity = 1;
    panel.style.transform = 'translateY(0)';
  });
}

// ======================================================
// PDF DISPLAY (UPGRADED)
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
      card.style.alignItems = "center";
      card.style.justifyContent = "space-between";
      card.style.background = "#f8f9fa";
      card.style.padding = "8px 12px";
      card.style.borderRadius = "6px";
      card.style.marginBottom = "6px";
      card.style.transition = "0.2s ease";

      card.onmouseenter = () => {
        card.style.background = "#e9ecef";
        card.style.transform = "translateY(-2px)";
      };

      card.onmouseleave = () => {
        card.style.background = "#f8f9fa";
        card.style.transform = "translateY(0)";
      };

      const name = document.createElement("div");
      name.innerHTML = `📄 ${file.name}`;
      name.style.fontWeight = "500";
      name.style.color = "black"; // ✅ Added to make PDF names black

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

      openBtn.onmouseenter = () => openBtn.style.background = "#0056b3";
      openBtn.onmouseleave = () => openBtn.style.background = "#007bff";

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
  const dz = document.getElementById('pdf-drop-zone');
  if (!dz) return;

  ['dragover','dragleave','drop'].forEach(evt =>
    dz.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
    })
  );

  dz.addEventListener('dragover', () =>
    dz.classList.add('drop-zone-active')
  );

  dz.addEventListener('dragleave', () =>
    dz.classList.remove('drop-zone-active')
  );

  dz.addEventListener('drop', async (e) => {
    dz.classList.remove('drop-zone-active');

    const files = e.dataTransfer.files;
    if (!files.length || !activeId) return;

    for (let file of files) {
      try {
        await window.api.uploadPDF(file, activeId);
      } catch (err) {
        console.error(err);
      }
    }

    loadPDFs(activeId);
  });
}

// ======================================================
// PANEL BUTTONS
// ======================================================
projectPanel.addEventListener('click', async (e) => {
  const target = e.target;

  if (target.id === 'saveBtn') {

    const data = {
      id: activeId,
      fName: getPanelFName(),
      lName: getPanelLName(),
      address: document.getElementById('p-address')?.value || '',
      status: document.getElementById('p-status')?.value || '',
      phone: document.getElementById('p-phone')?.value || '',
      email: document.getElementById('p-email')?.value || ''
    };

    await window.api.updateProject(data);
    await refreshList();
    alert("✅ Saved Successfully!");
    openClient(activeId);
  }

  if (target.id === 'delBtn') {
    if (confirm("Permanently delete this client?")) {
      await window.api.deleteClient(activeId);
      await refreshList();
      closePanel();
    }
  }

  if (target.id === 'closeBtn') closePanel();
});

// ======================================================
// HELPERS
// ======================================================
function getPanelFName() {
  const h2 = projectPanel.querySelector('h2');
  return h2 ? h2.innerText.split(' ')[0] : '';
}

function getPanelLName() {
  const h2 = projectPanel.querySelector('h2');
  return h2
    ? h2.innerText.split(' ').slice(1).join(' ')
    : '';
}

function closePanel() {
  const panel = projectPanel.querySelector('.animate-panel');
  if (!panel) return;

  panel.style.opacity = 0;
  panel.style.transform = 'translateY(-20px)';

  setTimeout(() => {
    projectPanel.innerHTML =
      '<div class="welcome-screen"><p>Select a client on the left</p></div>';
  }, 300);
}

clientList.addEventListener('click', (e) => {
  const item = e.target.closest('.client-item');
  if (item) openClient(parseInt(item.dataset.id));
});

// ======================================================
// INITIAL LOAD
// ======================================================
refreshList();
