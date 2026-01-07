// --- SIDEBAR ELEMENTS ---
const intakeForm = document.getElementById('clientIntakeForm');
const searchInput = document.getElementById('searchClients');
const clientList = document.getElementById('clientList');

// 1. ADD NEW CLIENT
intakeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const client = {
        fName: document.getElementById('fName').value,
        lName: document.getElementById('lName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value
    };
    
    await window.api.saveClient(client);
    refreshList();
    intakeForm.reset();
});

// 2. SEARCH CLIENTS (Searches Name, Phone, and Email instantly)
searchInput.addEventListener('input', async (e) => {
    const results = await window.api.searchClients(e.target.value);
    renderSidebar(results);
});

async function refreshList() {
    const all = await window.api.searchClients(''); // Empty search gets everyone
    renderSidebar(all);
}

function renderSidebar(list) {
    clientList.innerHTML = list.map(c => `
        <li class="client-item" onclick="openClient(${c.id})">
            <strong>${c.fName} ${c.lName}</strong><br>
            <small>${c.phone}</small>
        </li>
    `).join('');
}

// --- RIGHT PANEL ELEMENTS ---
let activeClientId = null;

async function openClient(id) {
    activeClientId = id;
    // Get all clients to find the specific one clicked
    const clients = await window.api.searchClients('');
    const client = clients.find(c => c.id === id);
    
    const panel = document.getElementById('projectPanel');
    panel.innerHTML = `
        <div class="detail-card">
            <h2>Project: ${client.fName} ${client.lName}</h2>
            <p><strong>Phone:</strong> ${client.phone} | <strong>Email:</strong> ${client.email}</p>
            
            <div class="roofing-grid">
                <div>
                    <label>Property Address</label>
                    <input type="text" id="p-addr" value="${client.address || ''}" placeholder="123 Main St...">
                </div>
                <div>
                    <label>Quote Amount ($)</label>
                    <input type="number" id="p-price" value="${client.pricing || ''}" placeholder="0.00">
                </div>
                <div style="grid-column: span 2;">
                    <label>Roofing Notes (Materials, Pitch, Damage)</label>
                    <textarea id="p-notes">${client.notes || ''}</textarea>
                </div>
                <button onclick="saveProjectData()" class="btn-primary" style="grid-column: span 2; background:#28a745;">
                    Save to Project File
                </button>
            </div>
        </div>
    `;
}

// 3. SAVE DETAILS TO SQLITE
window.saveProjectData = async () => {
    const data = {
        id: activeClientId,
        address: document.getElementById('p-addr').value,
        pricing: document.getElementById('p-price').value,
        notes: document.getElementById('p-notes').value
    };
    
    await window.api.updateProject(data);
    alert("Project details updated successfully!");
};

// Initial load of the sidebar
refreshList();
