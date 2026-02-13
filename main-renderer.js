// ======= DOM Elements =======
const clientList = document.getElementById('clientList');
const projectPanel = document.getElementById('projectPanel');
let activeId = null;
let searchTimeout;

// ======= API Safety Check =======
if (!window.api) {
  alert("API bridge not found. Check preload configuration.");
  throw new Error("window.api is undefined");
}

// ======= Smart Search =======
document.getElementById('searchClients').addEventListener('input', (e) => {
  const term = e.target.value;
  clearTimeout(searchTimeout);

  searchTimeout = setTimeout(async () => {
    try {
      const list = await window.api.searchClients(term);
      renderSidebar(list);
    } catch (err) {
      console.error("Search error:", err);
      alert("Search failed.");
    }
  }, 300);
});

// ======= Add New Client =======
document.getElementById('clientIntakeForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.innerText = "Saving...";

  const client = {
    fName: document.getElementById('fName').value.trim(),
    lName: document.getElementById('lName').value.trim(),
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim(),
  };

  try {
    const saved = await window.api.saveClient(client);

    if (!saved || !saved.id) throw new Error("Client save failed.");

    await refreshList();
    e.target.reset();
    alert("✅ Client added successfully!");
  } catch (err) {
    console.error("Save client failed:", err);
    alert("❌ Failed to add client.");
  }

  btn.disabled = false;
  btn.innerText = "Add Client";
});

// ======= Render Sidebar =======
async function refreshList() {
  try {
    const allClients = await window.api.searchClients('');
    renderSidebar(allClients);
  } catch (err) {
    console.error("Refresh failed:", err);
  }
}

function renderSidebar(list) {
  if (!clientList) return;

  if (!list || list.length === 0) {
    clientList.innerHTML = `<li style="padding:10px;">No clients found</li>`;
    return;
  }

  clientList.innerHTML = list.map(c => `
    <li class="client-item" data-id="${c.id}">
      <strong>${c.fName} ${c.lName}</strong><br>
      <small>${c.phone || ''}</small>
    </li>
  `).join('');
}

// ======= Open Client Details =======
async function openClient(id) {
  if (activeId === id && document.getElementById('saveBtn')) return;
  activeId = id;

  try {
    const allClients = await window.api.searchClients('');
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
  } catch (err) {
    console.error("Open client failed:", err);
    alert("Failed to load client.");
  }
}

// ======= Drag & Drop PDF Upload =======
function setupDropZone() {
  const dz = document.getElementById('pdf-drop-zone');
  if (!dz) return;

  ['dragover','dragleave','drop'].forEach(evt =>
    dz.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
    })
  );

  dz.addEventListener('dragover', () => dz.classList.add('drop-zone-active'));
  dz.addEventListener('dragleave', () => dz.classList.remove('drop-zone-active'));

  dz.addEventListener('drop', async (e) => {
    dz.classList.remove('drop-zone-active');
    const files = Array.from(e.dataTransfer.files);

    for (const f of files) {
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        alert("Only PDF files allowed.");
        continue;
      }

      try {
        const res = await window.api.uploadPdf({
          filePath: f.path,
          clientId: activeId
        });

        if (res.success) alert("✅ Uploaded: " + res.fileName);
        else alert("❌ Error: " + res.error);
      } catch (err) {
        console.error("Upload failed:", err);
        alert("Upload failed.");
      }
    }
  });
}

// ======= Project Panel Button Clicks =======
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

    try {
      const result = await window.api.updateProject(data);
      if (!result.success) throw new Error();

      await refreshList();
      alert("✅ Saved Successfully!");
    } catch (err) {
      console.error("Update failed:", err);
      alert("Failed to save changes.");
    }

    target.innerText = origText;
    target.disabled = false;
  }

  if (target.id === 'viewDocsBtn') {
    window.api.openFolder(activeId);
  }

  if (target.id === 'delBtn') {
    if (confirm("Permanently delete this lead?")) {
      try {
        await window.api.deleteClient(activeId);
        await refreshList();
        projectPanel.innerHTML = '<div class="welcome-screen"><p>Select a client on the left</p></div>';
      } catch (err) {
        console.error("Delete failed:", err);
        alert("Delete failed.");
      }
    }
  }

  if (target.id === 'closeBtn') {
    projectPanel.innerHTML = '<div class="welcome-screen"><p>Select a client on the left</p></div>';
  }
});

// ======= Open Client from Sidebar =======
clientList.addEventListener('click', (e) => {
  const item = e.target.closest('.client-item');
  if (item) openClient(parseInt(item.getAttribute('data-id')));
});

// ======= Initial Load =======
refreshList();
