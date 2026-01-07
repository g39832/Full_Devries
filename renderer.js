const intakeForm = document.getElementById('clientIntakeForm');
const searchInput = document.getElementById('searchClients');
const clientList = document.getElementById('clientList');
const projectPanel = document.getElementById('projectPanel');
let activeId = null;

/**
 * 1. SEARCH & REFRESH LOGIC
 */
async function refreshList(term = '') {
    const results = await window.api.searchClients(term);
    renderSidebar(results);
}

function renderSidebar(list) {
    if (!clientList) return;
    
    // We store the ID in 'data-id' instead of using onclick
    clientList.innerHTML = list.map(c => `
        <li class="client-item" data-id="${c.id}">
            <strong>${c.fName} ${c.lName}</strong><br>
            <small>${c.phone}</small>
        </li>
    `).join('');
}

// Listen for search input
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        refreshList(e.target.value);
    });
}

/**
 * 2. ADD CLIENT LOGIC
 */
if (intakeForm) {
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
}

/**
 * 3. EVENT DELEGATION (The "Click" Fix)
 * This listens for clicks on the UL, then finds the specific LI
 */
clientList.addEventListener('click', async (e) => {
    const item = e.target.closest('.client-item');
    if (item) {
        const id = parseInt(item.getAttribute('data-id'));
        openClient(id);
    }
});

/**
 * 4. PROJECT DETAIL PANEL
 */
async function openClient(id) {
    activeId = id;
    const all = await window.api.searchClients('');
    const client = all.find(c => c.id === id);
    
    if (!client) return;

    // Inject the HTML
    projectPanel.innerHTML = `
        <div class="detail-card">
            <h2>Project: ${client.fName} ${client.lName}</h2>
            <div class="roofing-grid">
                <label>Job Address</label>
                <input type="text" id="p-addr" value="${client.address || ''}">
                
                <label>Estimate Amount ($)</label>
                <input type="number" id="p-price" value="${client.pricing || ''}">
                
                <label>Notes</label>
                <textarea id="p-notes" style="width:100%; height:120px;">${client.notes || ''}</textarea>
                
                <button id="saveProjectBtn" class="btn-primary" style="background:#28a745; margin-top:10px;">Save Project</button>
                <button id="deleteClientBtn" class="btn-primary" style="background:#dc3545; margin-top:10px;">Delete Client</button>
            </div>
        </div>
    `;

    // ADD EVENT LISTENERS MANUALLY (To avoid CSP errors)
    document.getElementById('saveProjectBtn').addEventListener('click', saveProjectData);
    document.getElementById('deleteClientBtn').addEventListener('click', deleteCurrentClient);
}

/**
 * 5. SAVE & DELETE ACTIONS
 */
async function saveProjectData() {
    const data = {
        id: activeId,
        address: document.getElementById('p-addr').value,
        pricing: document.getElementById('p-price').value,
        notes: document.getElementById('p-notes').value
    };
    await window.api.updateProject(data);
    alert("Client project updated successfully!");
}

async function deleteCurrentClient() {
    if (confirm("Are you sure you want to permanently delete this client?")) {
        await window.api.deleteClient(activeId);
        projectPanel.innerHTML = `<div class="welcome-screen"><p>Client Deleted.</p></div>`;
        refreshList();
    }
}

// Initial load on page startup
refreshList();
