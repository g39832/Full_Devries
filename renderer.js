const clientForm = document.getElementById("clientForm");
const clientTable = document.getElementById("clientTable").querySelector("tbody");
const searchInput = document.getElementById("searchInput");
const clearFormBtn = document.getElementById("clearFormBtn");

async function fetchClients(term = "") {
  const res = await fetch(`/search-clients?term=${encodeURIComponent(term)}`);
  const data = await res.json();
  renderClients(data);
}

function renderClients(clients) {
  clientTable.innerHTML = "";
  clients.forEach(client => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${client.fName}</td>
      <td>${client.lName}</td>
      <td>${client.email}</td>
      <td>${client.phone}</td>
      <td>${client.project || ""}</td>
      <td>
        <button class="edit-btn" data-id="${client.id}">Edit</button>
        <button class="delete-btn" data-id="${client.id}">Delete</button>
      </td>
    `;
    clientTable.appendChild(tr);
  });
}

// Save or Update Client
clientForm.addEventListener("submit", async e => {
  e.preventDefault();
  const clientId = document.getElementById("clientId").value;
  const clientData = {
    id: clientId ? parseInt(clientId) : undefined,
    fName: document.getElementById("fName").value,
    lName: document.getElementById("lName").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("phone").value,
    project: document.getElementById("project").value,
  };

  const url = clientId ? "/update-project" : "/save-client";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clientData)
  });
  const result = await res.json();
  if (result.success) {
    clientForm.reset();
    fetchClients();
  } else {
    alert("Error saving client!");
  }
});

// Edit / Delete Buttons
clientTable.addEventListener("click", async e => {
  if (e.target.classList.contains("edit-btn")) {
    const row = e.target.closest("tr");
    document.getElementById("clientId").value = e.target.dataset.id;
    document.getElementById("fName").value = row.cells[0].innerText;
    document.getElementById("lName").value = row.cells[1].innerText;
    document.getElementById("email").value = row.cells[2].innerText;
    document.getElementById("phone").value = row.cells[3].innerText;
    document.getElementById("project").value = row.cells[4].innerText;
  }

  if (e.target.classList.contains("delete-btn")) {
    if (confirm("Delete this client?")) {
      const res = await fetch("/delete-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: parseInt(e.target.dataset.id) })
      });
      const result = await res.json();
      if (result.success) fetchClients();
      else alert("Error deleting client!");
    }
  }
});

// Search
searchInput.addEventListener("input", () => fetchClients(searchInput.value));

// Clear form
clearFormBtn.addEventListener("click", () => clientForm.reset());

// Initial fetch
fetchClients();
