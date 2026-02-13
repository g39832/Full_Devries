console.log("🔥 MAIN IS RUNNING 🔥");

// ===== DOM Elements =====
const clientList = document.getElementById('clientList');
const projectPanel = document.getElementById('projectPanel');
let activeId = null;
let searchTimeout;

// ===== Helper: API Fetch =====
async function apiFetch(endpoint, method = 'GET', body = null) {
  const options = { method, headers: {} };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(endpoint, options);
  return res.json();
}

// ===== Smart Search =====
document.getElementById('searchClients').addEventListener('input', (e) => {
  const term = e.target.value;
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const list = await apiFetch(`/api/clients/search?term=${encodeURIComponent(term)}`);
    renderSidebar(list);
  }, 300);
});

// ===== Add New Client =====
document.getElementById('clientIntakeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const client = {
    fName: document.getElementById('fName').value,
    lName: document.getElementById('lName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
  };

  const res = await apiFetch('/api/clients/add', 'POST', client);
  if (res.id) {
    refreshList();
    e.target.reset();
    alert("Client added successfully!");
  } else {
    alert("Failed to add client");
  }
});

// ===== Render Sidebar =====
async function refreshList() {
  const allClients = await apiFetch('/api/clients/search?term=');
  renderSidebar(allClients);
}

function renderSidebar(list) {
  if (!clientList) return;
  clientList.innerHTML = list.map(c => `
    <li class="client-item" data-id="${c.id}">
      <strong>${c.fName} ${c.lName}</strong><br>
      <small>${c.phone}</small>
    </li>
  `).join('');
}

// ===== Open Client Details =====
async function openClient(id) {
  if (activeId === id && document.getElementById('saveBtn')) return;
  activeId = id;

  const allClients = await apiFetch('/api/clients/search?term=');
  const client = allClients.find(c => c.id === id);
  if (!client) return;

  projectPanel.innerHTML = `
    <div class="detail-card">
      <button id="closeBtn" class="close-x">&times;</button>
      <header class="detail-header">
        <h2>${client.fName} ${client.lName}</h2>
        <div class="contact-quick-links">
          <span>📞 <a href="tel:${client.phone}">${client.phone}</a></span>
          <span style="margin-left:20px;">✉️ <a href="mailto:${client.email}">${client.email}</a></span>
        </div>
      </header>

      <div class="roofing-grid">
        <div style="grid-column: span 2;">
          <label>Job Status</label>
          <select id="p-status">
            <option value="Lead" ${client.status === 'Lead' ? 'selected' : ''}>New Lead</option>
            <option value="Active" ${client.status === 'Active' ? 'selected' : ''}>Active Job</option>
            <option value="Completed" ${client.status === 'Completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>

        <label>Phone Number</label><input type="tel" id="p-phone" value="${client.phone || ''}">
        <label>Email Address</label><input type="email" id="p-email" value="${client.email || ''}">
        <label>Job Address</label><input type="text" id="p-addr" value="${client.address || ''}">
        <label>Price ($)</label><input type="number" id="p-price" value="${client.pricing || ''}">
        <label style="grid-column: span 2;">Internal Notes</label>
        <textarea id="p-notes" style="grid-column: span 2;">${client.notes || ''}</textarea>

        <div id="pdf-drop-zone" class="drop-zone" style="grid-column: span 2;">
          📄 Drop Client PDFs Here (Contracts, Estimates, etc.)
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
}

// ===== Drag & Drop PDF Upload =====
function setupDropZone() {
  const dz = document.getElementById('pdf-drop-zone');
  if (!dz) return;

  ['dragover','dragleave','drop'].forEach(evt =>
    dz.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); })
  );

  dz.addEventListener('dragover', () => dz.classList.add('drop-zone-active'));
  dz.addEventListener('dragleave', () => dz.classList.remove('drop-zone-active'));
  dz.addEventListener('drop', async (e) => {
    dz.classList.remove('drop-zone-active');
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        alert("Only PDF files are allowed.");
        continue;
      }

      const formData = new FormData();
      formData.append('pdf', f);
      formData.append('clientId', activeId);

      const res = await fetch('/api/pdf/upload', { method: 'POST', body: formData });
      const result = await res.json();
      if (result.success) alert("✅ Uploaded: " + result.fileName);
      else alert("❌ Error: " + result.error);
    }
  });
}

// ===== Project Panel Button Clicks =====
projectPanel.addEventListener('click', async (e) => {
  const target = e.target;

  if (target.id === 'saveBtn') {
    const origText = target.innerText;
    target.innerText = "Saving...";
    target.disabled = true;

    const data = {
      id: activeId,
      address: document.getElementById('p-addr').value,
      pricing: document.getElementById('p-price').value,
      notes: document.getElementById('p-notes').value,
      status: document.getElementById('p-status').value,
      phone: document.getElementById('p-phone').value,
      email: document.getElementById('p-email').value
    };

    const res = await apiFetch('/api/clients/update', 'POST', data);
    if (res.success) {
      refreshList();
      alert("✅ Saved Successfully!");
    } else {
      alert("Failed to save changes.");
    }

    target.innerText = origText;
    target.disabled = false;
  }

  if (target.id === 'viewDocsBtn') {
    // Open folder request
    const res = await apiFetch(`/api/pdf/folder/${activeId}`);
    if (!res.success) alert("Folder not found or cannot open");
  }

  if (target.id === 'delBtn') {
    if (confirm("Permanently delete this lead?")) {
      const res = await apiFetch(`/api/clients/delete/${activeId}`, 'POST');
      if (res.success) {
        refreshList();
        projectPanel.innerHTML = '<div class="welcome-screen"><p>Select a client on the left</p></div>';
      }
    }
  }

  if (target.id === 'closeBtn') {
    projectPanel.innerHTML = '<div class="welcome-screen"><p>Select a client on the left</p></div>';
  }
});

// ===== Open Client from Sidebar =====
clientList.addEventListener('click', (e) => {
  const item = e.target.closest('.client-item');
  if (item) openClient(parseInt(item.getAttribute('data-id')));
});

// ===== Initial Load =====
refreshList();
