const clientList = document.getElementById('clientList');
const projectPanel = document.getElementById('projectPanel');
let activeId = null;
let searchTimeout;

// 1. SMART SEARCH (Debounced for performance)
document.getElementById('searchClients').addEventListener('input', (e) => {
    const term = e.target.value;
    
    // Clear previous timer - only search 300ms after user stops typing
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const list = await window.api.searchClients(term);
        renderSidebar(list);
    }, 300); 
});

// 2. INTAKE FORM
document.getElementById('clientIntakeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = {
        fName: document.getElementById('fName').value,
        lName: document.getElementById('lName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value
    };
    await window.api.saveClient(c);
    refreshList();
    e.target.reset();
});

// 3. SIDEBAR RENDERING
async function refreshList() {
    const all = await window.api.searchClients('');
    renderSidebar(all);
}

function renderSidebar(list) {
    if (!clientList) return;
    // Fast batch rendering
    clientList.innerHTML = list.map(c => `
        <li class="client-item" data-id="${c.id}">
            <strong>${c.fName} ${c.lName}</strong><br><small>${c.phone}</small>
        </li>`).join('');
}

clientList.addEventListener('click', (e) => {
    const item = e.target.closest('.client-item');
    if (item) openClient(parseInt(item.getAttribute('data-id')));
});

// 4. PROJECT DETAIL PANEL
async function openClient(id) {
    activeId = id;
    const all = await window.api.searchClients('');
    const client = all.find(c => c.id === id);
    
    projectPanel.innerHTML = `
        <div class="detail-card">
            <button id="closeBtn" class="close-x">&times;</button>
            <h2>Project: ${client.fName} ${client.lName}</h2>
            <div class="roofing-grid">
                <div style="grid-column: span 2;">
                    <label>Job Status</label>
                    <select id="p-status">
                        <option value="Lead" ${client.status === 'Lead' ? 'selected' : ''}>New Lead</option>
                        <option value="Active" ${client.status === 'Active' ? 'selected' : ''}>Active Job</option>
                        <option value="Completed" ${client.status === 'Completed' ? 'selected' : ''}>Completed</option>
                    </select>
                </div>
                <label>Address</label><input type="text" id="p-addr" value="${client.address || ''}">
                <label>Price</label><input type="number" id="p-price" value="${client.pricing || ''}">
                <label style="grid-column: span 2;">Notes</label>
                <textarea id="p-notes" style="grid-column: span 2;">${client.notes || ''}</textarea>
                <button id="saveBtn" class="btn-primary" style="background:#28a745;">Save</button>
                <button id="delBtn" class="btn-primary" style="background:#dc3545;">Delete</button>
            </div>
        </div>`;

    document.getElementById('closeBtn').onclick = () => projectPanel.innerHTML = '<p class="welcome-screen">Select a client</p>';
    document.getElementById('saveBtn').onclick = saveProject;
    document.getElementById('delBtn').onclick = deleteClient;
}

async function saveProject() {
    const d = { 
        id: activeId, 
        address: document.getElementById('p-addr').value, 
        pricing: document.getElementById('p-price').value, 
        notes: document.getElementById('p-notes').value, 
        status: document.getElementById('p-status').value 
    };
    await window.api.updateProject(d);
    alert("Saved to Database!");
}

async function deleteClient() {
    if (confirm("Permanently delete this lead?")) {
        await window.api.deleteClient(activeId);
        refreshList();
        projectPanel.innerHTML = '';
    }
}

// Startup
refreshList();
