// main-renderer.js

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
  searchClients: async (term) => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
    if (!res.ok) throw new Error('Failed to fetch clients');
    return await res.json();
  },

  saveClient: async (client) => {
    const name = `${client.fName || ''} ${client.lName || ''}`.trim();
    const payload = { ...client, name };
    const res = await fetch('/api/save-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to save client');
    return await res.json();
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
    if (!res.ok) throw new Error('Failed to update project');
    return await res.json();
  },

  deleteClient: async (id) => {
    const res = await fetch('/api/delete-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (!res.ok) throw new Error('Failed to delete client');
    return await res.json();
  }
};

// =========================
// DOM ELEMENTS
// =========================
const clientList = document.getElementById('clientList');
const projectPanel = document.getElementById('projectPanel');
let activeId = null;
let searchTimeout;

// =========================
// Smart Search (Now Supports Status Filtering)
// =========================
document.getElementById('searchClients').addEventListener('input', (e) => {
  const term = e.target.value.trim().toLowerCase();
  clearTimeout(searchTimeout);

  searchTimeout = setTimeout(async () => {
    try {
      const allClients = await window.api.searchClients('');

      // Check if search term matches a status exactly
      const matchedStatus = STATUS_ORDER.find(
        status => status.toLowerCase() === term
      );

      if (matchedStatus) {
        const filtered = allClients.filter(
          c => (c.status || "Lead").toLowerCase() === term
        );
        renderSidebar(filtered);
        return;
      }

      // Otherwise use normal backend search
      const list = await window.api.searchClients(term);
      renderSidebar(list);

    } catch (err) {
      console.error("Search failed:", err);
    }
  }, 300);
});

// =========================
// Add New Client
// =========================
document.getElementById('clientIntakeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const client = {
    fName: document.getElementById('fName').value,
    lName: document.getElementById('lName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    address: document.getElementById('address').value,
    status: "Lead"
  };

  try {
    await window.api.saveClient(client);
    await refreshList();
    e.target.reset();
    alert('✅ Client added!');
  } catch (err) {
    console.error(err);
    alert('❌ Failed to add client.');
  }
});

// =========================
// Render Sidebar
// =========================
async function refreshList() {
  const allClients = await window.api.searchClients('');
  renderSidebar(allClients);
}

function renderSidebar(list) {
  if (!clientList) return;

  list.sort((a, b) => {
    const aIndex = STATUS_ORDER.indexOf(a.status || "Lead");
    const bIndex = STATUS_ORDER.indexOf(b.status || "Lead");
    return aIndex - bIndex;
  });

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
      <li class="client-item" data-id="${c.id}" style="border-left:4px solid ${color}; padding-left:8px;">
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

// =========================
// Open Client Details
// =========================
async function openClient(id) {
  if (activeId === id && document.getElementById('saveBtn')) return;
  activeId = id;

  const allClients = await window.api.searchClients('');
  const client = allClients.find(c => c.id == id);
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
          <span style="margin-left:20px;">✉️ <a href="mailto:${client.email}">${client.email || ''}</a></span>
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
          ${client.address ? `<a href="${mapsLink}" target="_blank" style="color:#007bff; font-size:0.9rem;">📍 Open in Google Maps</a>` : ''}
        </div>

        <label>Phone Number</label>
        <input type="tel" id="p-phone" value="${client.phone || ''}">

        <label>Email Address</label>
        <input type="email" id="p-email" value="${client.email || ''}">

        <div id="pdf-drop-zone" class="drop-zone" style="grid-column: span 2;">
          📄 Drop Client PDFs Here
        </div>

        <div style="grid-column: span 2; display:flex; gap:10px; margin-top:10px;">
          <button id="saveBtn" class="btn-primary" style="background:#28a745; flex:2;">Save Changes</button>
          <button id="viewDocsBtn" class="btn-primary" style="background:#6c757d; flex:1;">📂 Open Folder</button>
          <button id="delBtn" class="btn-primary" style="background:#dc3545; flex:1;">Delete</button>
        </div>

      </div>
    </div>
  `;

  setupDropZone();

  const panel = projectPanel.querySelector('.animate-panel');
  requestAnimationFrame(() => {
    panel.style.opacity = 1;
    panel.style.transform = 'translateY(0)';
  });
}

// =========================
// Close Client Panel
// =========================
function closeClientPanel() {
  const panel = projectPanel.querySelector('.animate-panel');
  if (!panel) return;
  panel.style.opacity = 0;
  panel.style.transform = 'translateY(-20px)';
  setTimeout(() => {
    projectPanel.innerHTML = '<div class="welcome-screen"><p>Select a client on the left</p></div>';
  }, 300);
}

// =========================
// Drag & Drop
// =========================
function setupDropZone() {
  const dz = document.getElementById('pdf-drop-zone');
  if (!dz) return;

  ['dragover','dragleave','drop'].forEach(evt =>
    dz.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); })
  );

  dz.addEventListener('dragover', () => dz.classList.add('drop-zone-active'));
  dz.addEventListener('dragleave', () => dz.classList.remove('drop-zone-active'));
}

// =========================
// Panel Buttons
// =========================
projectPanel.addEventListener('click', async (e) => {
  const target = e.target;

  if (target.id === 'saveBtn') {
    const data = {
      id: activeId,
      fName: clientPanelFName(),
      lName: clientPanelLName(),
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

  if (target.id === 'viewDocsBtn') window.api.openFolder?.(activeId);

  if (target.id === 'delBtn') {
    if (confirm("Permanently delete this client?")) {
      await window.api.deleteClient(activeId);
      await refreshList();
      closeClientPanel();
    }
  }

  if (target.id === 'closeBtn') closeClientPanel();
});

// =========================
// Helpers
// =========================
function clientPanelFName() {
  const h2 = projectPanel.querySelector('h2');
  return h2 ? h2.innerText.split(' ')[0] : '';
}

function clientPanelLName() {
  const h2 = projectPanel.querySelector('h2');
  return h2 ? h2.innerText.split(' ').slice(1).join(' ') : '';
}

clientList.addEventListener('click', (e) => {
  const item = e.target.closest('.client-item');
  if (item) openClient(parseInt(item.getAttribute('data-id')));
});

// =========================
// Initial Load
// =========================
refreshList();
