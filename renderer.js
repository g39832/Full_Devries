const clientList = document.getElementById('clientList');
const projectPanel = document.getElementById('projectPanel');
let activeId = null;
let searchTimeout;

/**
 * 1. smart search
 * Filters the sidebar as you type.
 */
document.getElementById('searchClients').addEventListener('input', (e) => {
    const term = e.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const list = await window.api.searchClients(term);
        renderSidebar(list);
    }, 300); 
});

/**
 * 2. intake form
 * Saves a new lead and refreshes the sidebar.
 */
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

/**
 * 3. sidebar rendering
 */
async function refreshList() {
    const all = await window.api.searchClients('');
    renderSidebar(all);
}

function renderSidebar(list) {
    if (!clientList) return;
    clientList.innerHTML = list.map(c => `
        <li class="client-item" data-id="${c.id}">
            <strong>${c.fName} ${c.lName}</strong><br><small>${c.phone}</small>
        </li>`).join('');
}

/**
 * 4. Project panel event regulating 
 * This handles button clicks inside the right panel even after the HTML is refreshed.
 */
projectPanel.addEventListener('click', async (e) => {
    const target = e.target;

    // save logic
    if (target.id === 'saveBtn') {
        const originalText = target.innerText;
        target.innerText = "Saving...";
        target.disabled = true;

        const d = { 
            id: activeId, 
            address: document.getElementById('p-addr').value, 
            pricing: document.getElementById('p-price').value, 
            notes: document.getElementById('p-notes').value, 
            status: document.getElementById('p-status').value,
            phone: document.getElementById('p-phone').value,
            email: document.getElementById('p-email').value
        };

        try {
            await window.api.updateProject(d);
            
            // Instant Header Link Update
            const quickLinks = document.querySelector('.contact-quick-links');
            if (quickLinks) {
                quickLinks.innerHTML = `
                    <span>📞 <a href="tel:${d.phone}">${d.phone}</a></span>
                    <span style="margin-left: 20px;">✉️ <a href="mailto:${d.email}">${d.email}</a></span>
                `;
            }

            refreshList(); // Update sidebar in background
            target.innerText = originalText;
            target.disabled = false;
            alert("✅ Saved Successfully!");
        } catch (error) {
            console.error("Save Error:", error);
            alert("Failed to save changes.");
            target.innerText = originalText;
            target.disabled = false;
        }
    }

    // Open folder logic
    if (target.id === 'viewDocsBtn') {
        window.api.openFolder(activeId);
    }

    // delete client logic 
    if (target.id === 'delBtn') {
        if (confirm("Permanently delete this lead?")) {
            await window.api.deleteClient(activeId);
            refreshList();
            projectPanel.innerHTML = '<div class="welcome-screen"><p>Select a client on the left</p></div>';
        }
    }

    // Close panel logic 
    if (target.id === 'closeBtn') {
        projectPanel.innerHTML = '<div class="welcome-screen"><p>Select a client on the left</p></div>';
    }
});

/**
 * 5. Drag and drop zone pdf 
 */
function setupDropZone() {
    const dz = document.getElementById('pdf-drop-zone');
    if (!dz) return;

    ['dragover', 'dragleave', 'drop'].forEach(name => {
        dz.addEventListener(name, e => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    dz.addEventListener('dragover', () => dz.classList.add('drop-zone-active'));
    dz.addEventListener('dragleave', () => dz.classList.remove('drop-zone-active'));

    dz.addEventListener('drop', async (e) => {
        dz.classList.remove('drop-zone-active');
        const files = Array.from(e.dataTransfer.files);
        
        for (const f of files) {
            // FIX: Use the 2026 bridge to get the path securely
            const filePath = window.api.getFilePath(f);

            if (filePath && (f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf')) {
                const res = await window.api.uploadPdf({ filePath: filePath, clientId: activeId });
                if (res.success) alert("✅ Uploaded: " + res.fileName);
                else alert("❌ Error: " + res.error);
            } else {
                alert("Only PDF files are allowed.");
            }
        }
    });
}

/**
 * 6. open clint details 
 */
async function openClient(id) {
    // Avoid re-rendering if already open
    if (activeId === id && document.getElementById('saveBtn')) return;
    
    activeId = id;
    const all = await window.api.searchClients('');
    const client = all.find(c => c.id === id);
    if (!client) return;

    projectPanel.innerHTML = `
        <div class="detail-card">
            <button id="closeBtn" class="close-x">&times;</button>
            <header class="detail-header">
                <h2>${client.fName} ${client.lName}</h2>
                <div class="contact-quick-links">
                    <span>📞 <a href="tel:${client.phone}">${client.phone}</a></span>
                    <span style="margin-left: 20px;">✉️ <a href="mailto:${client.email}">${client.email}</a></span>
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
                
                <div style="grid-column: span 2; display: flex; gap: 10px; margin-top: 10px;">
                    <button id="saveBtn" class="btn-primary" style="background:#28a745; flex: 2;">Save Changes</button>
                    <button id="viewDocsBtn" class="btn-primary" style="background:#6c757d; flex: 1;">📂 Open Folder</button>
                    <button id="delBtn" class="btn-primary" style="background:#dc3545; flex: 1;">Delete</button>
                </div>
            </div>
        </div>`;
        
    setupDropZone();
}

/**
 * 7. startup and sidebar clicks 
 */
clientList.addEventListener('click', (e) => {
    const item = e.target.closest('.client-item');
    if (item) openClient(parseInt(item.getAttribute('data-id')));
});

refreshList();
