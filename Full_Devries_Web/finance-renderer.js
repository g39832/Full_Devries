// ====================================================== 
// FINANCE PAGE RENDERER (Stable + Instant Preview)
// ======================================================

const taxGroups = ["w9", "pnl", "1099", "inference"];
const financeTableBody = document.getElementById("metricsBody");
const yearSelector = document.getElementById("finance-year");

let activeYear = new Date().getFullYear();

// ======================================================
// LOAD AVAILABLE YEARS (NEW - AUTO DROPDOWN)
// ======================================================
async function loadAvailableYears() {
  if (!yearSelector) return;

  try {
    const res = await fetch("/api/finance/years");
    if (!res.ok) throw new Error("Failed to fetch years");

    const years = await res.json();

    yearSelector.innerHTML = "";

    years.forEach((year) => {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      yearSelector.appendChild(option);
    });

    // Default to newest year in DB or current year
    const newestYear = years[0] || new Date().getFullYear();
    activeYear = parseInt(newestYear);
    yearSelector.value = activeYear;

  } catch (err) {
    console.error("Year dropdown error:", err);

    // Fallback to current year only
    yearSelector.innerHTML = `<option value="${activeYear}">${activeYear}</option>`;
  }
}

// ======================================================
// SAFE ELEMENT FINDER
// ======================================================
function findGroupContainer(group) {
  return document.querySelector(
    `[id*="${group}"][id*="group"], [data-group="${group}"]`
  );
}

function findListContainer(group) {
  return document.querySelector(
    `[id*="${group}"][id*="list"], [data-list="${group}"]`
  );
}

// ======================================================
// FETCH SUMMARY
// ======================================================
async function fetchFinanceSummary(year) {
  try {
    const res = await fetch(`/api/finance/summary?year=${year}`);
    if (!res.ok) throw new Error("Failed to fetch summary");
    return await res.json();
  } catch (err) {
    console.error("Finance summary error:", err);
    return null;
  }
}

// ======================================================
// UPDATE METRICS
// ======================================================
async function updateFinanceMetrics() {
  if (!financeTableBody) return;

  try {
    const summary = await fetchFinanceSummary(activeYear);

    if (!summary) {
      financeTableBody.innerHTML =
        "<tr><td colspan='5'>No data found</td></tr>";
      return;
    }

    financeTableBody.innerHTML = `
      <tr>
        <td>${summary.year}</td>
        <td>$${Number(summary.totalExpected || 0).toLocaleString()}</td>
        <td>$${Number(summary.totalReceived || 0).toLocaleString()}</td>
        <td>$${Number(summary.totalRemaining || 0).toLocaleString()}</td>
        <td>${summary.totalClients || 0} clients</td>
      </tr>
    `;
  } catch (err) {
    console.error("Metrics error:", err);
  }
}

// ======================================================
// YEAR SELECTOR
// ======================================================
if (yearSelector) {
  yearSelector.addEventListener("change", (e) => {
    activeYear = parseInt(e.target.value) || new Date().getFullYear();
    updateFinanceMetrics();
    taxGroups.forEach((group) => loadPDFs(group));
  });
}

// ======================================================
// ADD UPLOAD BUTTONS (Fixed + Styled)
// ======================================================
function addUploadButtons() {
  taxGroups.forEach((group) => {
    const container = findGroupContainer(group);
    if (!container) return;

    if (container.querySelector(`[data-upload="${group}"]`)) return;

    const btn = document.createElement("button");
    btn.innerText = "Upload PDF";
    btn.setAttribute("data-upload", group);

    btn.style.marginTop = "10px";
    btn.style.background = "#0d6efd";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.padding = "8px 14px";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.style.fontWeight = "600";
    btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";

    btn.onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf";
      input.style.display = "none";

      input.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        await uploadPDF(file, `${group}-${activeYear}`);
        loadPDFs(group);
      });

      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    };

    container.appendChild(btn);
  });
}

// ======================================================
// UPLOAD
// ======================================================
async function uploadPDF(file, groupKey) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch(`/api/pdf/upload/${groupKey}`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) throw new Error("Upload failed");
    return await res.json();
  } catch (err) {
    console.error("Upload error:", err);
  }
}

// ======================================================
// LOAD PDFs
// ======================================================
async function loadPDFs(group) {
  const container = findListContainer(group);
  if (!container) return;

  container.innerHTML = "";

  try {
    const res = await fetch(`/api/pdf/list/${group}-${activeYear}`);
    if (!res.ok) throw new Error("List failed");

    const data = await res.json();

    if (!data.files || data.files.length === 0) {
      container.innerHTML =
        `<div style="color:#888;font-size:13px;">No PDFs uploaded.</div>`;
      return;
    }

    data.files.forEach((file) => {
      const card = document.createElement("div");
      card.style.display = "inline-flex";
      card.style.flexDirection = "column";
      card.style.alignItems = "center";
      card.style.margin = "12px";
      card.style.padding = "10px";
      card.style.background = "#f8f9fa";
      card.style.borderRadius = "8px";
      card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";

      const thumb = document.createElement("embed");
      thumb.src = file.url;
      thumb.type = "application/pdf";
      thumb.width = "100";
      thumb.height = "120";
      thumb.style.borderRadius = "6px";
      card.appendChild(thumb);

      const name = document.createElement("div");
      name.innerText = file.name;
      name.style.fontSize = "12px";
      name.style.marginTop = "6px";
      name.style.textAlign = "center";
      card.appendChild(name);

      const viewBtn = document.createElement("button");
      viewBtn.innerText = "View";
      viewBtn.style.marginTop = "8px";
      viewBtn.style.background = "#198754";
      viewBtn.style.color = "#fff";
      viewBtn.style.border = "none";
      viewBtn.style.padding = "6px 12px";
      viewBtn.style.borderRadius = "5px";
      viewBtn.style.cursor = "pointer";
      viewBtn.style.fontWeight = "600";
      viewBtn.onclick = () => openPDFModal(file.url);
      card.appendChild(viewBtn);

      const delBtn = document.createElement("button");
      delBtn.innerText = "Delete";
      delBtn.style.marginTop = "6px";
      delBtn.style.background = "#dc3545";
      delBtn.style.color = "#fff";
      delBtn.style.border = "none";
      delBtn.style.padding = "6px 12px";
      delBtn.style.borderRadius = "5px";
      delBtn.style.cursor = "pointer";
      delBtn.style.fontWeight = "600";

      delBtn.onclick = async () => {
        if (!confirm(`Delete ${file.name}?`)) return;

        await fetch(
          `/api/pdf/delete/${group}-${activeYear}?file=${encodeURIComponent(file.name)}`,
          { method: "DELETE" }
        );

        loadPDFs(group);
      };

      card.appendChild(delBtn);
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Load PDFs error:", err);
  }
}

// ======================================================
// RESPONSIVE MODAL VIEWER
// ======================================================
function openPDFModal(url) {
  const modal = document.getElementById("pdfModal");
  const viewer = document.getElementById("pdfViewer");
  if (!modal || !viewer) return;

  viewer.innerHTML = "";

  const embed = document.createElement("embed");
  embed.src = url;
  embed.type = "application/pdf";
  embed.style.width = "100%";
  embed.style.height = "90vh";
  embed.style.border = "none";

  viewer.appendChild(embed);
  modal.style.display = "flex";
}

// ======================================================
// MODAL CLOSE
// ======================================================
{
  const modal = document.getElementById("pdfModal");
  const closeBtn = document.getElementById("pdfModalClose");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
      document.getElementById("pdfViewer").innerHTML = "";
    });
  }

  document.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      document.getElementById("pdfViewer").innerHTML = "";
    }
  });
}

// ======================================================
// INIT
// ======================================================
(async function initFinancePage() {
  await loadAvailableYears();
  await updateFinanceMetrics();
  taxGroups.forEach((group) => loadPDFs(group));
  addUploadButtons();
})();