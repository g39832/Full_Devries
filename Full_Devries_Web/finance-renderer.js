// ====================================================== 
// FINANCE PAGE RENDERER (Stable + Live Updates from Payments & Clients)
// ======================================================

const taxGroups = ["w9", "pnl", "1099", "inference"];
const financeTableBody = document.getElementById("metricsBody");
const yearSelector = document.getElementById("finance-year");

let activeYear = new Date().getFullYear();
let financeUndoStack = [];

function formatCurrencyValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseCurrencyValue(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function applyCurrencyInputBehavior(input) {
  if (!input) return;

  function formatTypingValue(raw) {
    if (!raw) return "";
    const cleaned = String(raw).replace(/[^0-9.]/g, "");
    if (!cleaned) return "";

    const firstDot = cleaned.indexOf(".");
    let integerPart = cleaned;
    let decimalPart = "";
    let hasDot = false;

    if (firstDot >= 0) {
      hasDot = true;
      integerPart = cleaned.slice(0, firstDot);
      decimalPart = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    }

    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
    const displayInteger = normalizedInteger || (hasDot ? "0" : "");
    const formattedInteger = displayInteger
      ? Number(displayInteger).toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "";

    if (hasDot) return `${formattedInteger}.${decimalPart}`;
    return formattedInteger;
  }

  function caretPosFromDigitCount(value, digitCount) {
    if (digitCount <= 0) return 0;
    let count = 0;
    for (let i = 0; i < value.length; i++) {
      if (/\d/.test(value[i])) count++;
      if (count === digitCount) return i + 1;
    }
    return value.length;
  }

  input.addEventListener("input", () => {
    const selectionStart = input.selectionStart ?? input.value.length;
    const beforeCursor = input.value.slice(0, selectionStart);
    const digitsBefore = (beforeCursor.match(/\d/g) || []).length;

    const formatted = formatTypingValue(input.value);
    input.value = formatted;

    const nextPos = caretPosFromDigitCount(formatted, digitsBefore);
    input.setSelectionRange(nextPos, nextPos);
  });

  input.addEventListener("blur", () => {
    const raw = input.value.trim();
    if (!raw) return;
    input.value = formatCurrencyValue(parseCurrencyValue(raw));
  });
}

// ======================================================
// LOAD AVAILABLE YEARS (AUTO DROPDOWN)
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

    const newestYear = years[0] || new Date().getFullYear();
    activeYear = parseInt(newestYear);
    yearSelector.value = activeYear;

  } catch (err) {
    console.error("Year dropdown error:", err);
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
// UPDATE METRICS (Editable Version)
// ======================================================
async function updateFinanceMetrics() {
  if (!financeTableBody) return;

  try {
    const summary = await fetchFinanceSummary(activeYear);

    const expected = summary?.totalExpected || 0;
    const received = summary?.totalReceived || 0;
    const remaining = summary?.totalRemaining || 0;
    const clients = summary?.totalClients || 0;

    financeTableBody.innerHTML = `
      <tr class="metrics-values-row">
        <td data-label="Year">${activeYear}</td>
        <td data-label="Expected Earnings"><input type="text" id="input-expected" inputmode="decimal" value="${formatCurrencyValue(expected)}" /></td>
        <td data-label="Received"><input type="text" id="input-received" inputmode="decimal" value="${formatCurrencyValue(received)}" /></td>
        <td data-label="Remaining"><input type="text" id="input-remaining" inputmode="decimal" value="${formatCurrencyValue(remaining)}" /></td>
        <td data-label="Clients"><input type="number" id="input-clients" inputmode="numeric" enterkeyhint="done" pattern="[0-9]*" step="1" value="${clients}" /></td>
      </tr>
      <tr class="metrics-actions-row">
        <td colspan="5" class="metrics-actions-cell" style="text-align:right;">
        <button id="saveFinanceBtn">Save Year Data</button>
          <button id="undoFinanceYearBtn"
          style="margin-left:10px; background:#dc3545; color:white; border:none; padding:6px 12px; border-radius:5px; cursor:pointer;">
            Undo
           </button>
</td>
      </tr>
    `;

    document
      .getElementById("saveFinanceBtn")
      .addEventListener("click", saveFinanceYear);

    document
    .getElementById("undoFinanceYearBtn")
    .addEventListener("click", undoFinanceYear);

    ["input-expected", "input-received", "input-remaining"].forEach((id) => {
      const input = document.getElementById(id);
      applyCurrencyInputBehavior(input);
    });

  } catch (err) {
    console.error("Metrics error:", err);
  }
}

// ======================================================
// SAVE MANUAL YEAR DATA
// ======================================================
async function saveFinanceYear() {

  // 🔥 Store previous saved state before overwriting
  const previousSummary = await fetchFinanceSummary(activeYear);

  financeUndoStack.push({
    year: activeYear,
    totalExpected: previousSummary?.totalExpected || 0,
    totalReceived: previousSummary?.totalReceived || 0,
    totalRemaining: previousSummary?.totalRemaining || 0,
    totalClients: previousSummary?.totalClients || 0
  });

  const data = {
    year: activeYear,
    totalExpected: parseCurrencyValue(document.getElementById("input-expected").value),
    totalReceived: parseCurrencyValue(document.getElementById("input-received").value),
    totalRemaining: parseCurrencyValue(document.getElementById("input-remaining").value),
    totalClients: Number(document.getElementById("input-clients").value),
  };

  try {
    const res = await fetch("/api/finance/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) throw new Error("Save failed");

    alert("Finance data saved successfully.");
    document.dispatchEvent(new Event("financeUpdated"));

  } catch (err) {
    console.error("Save error:", err);
    alert("Error saving finance data.");
  }
}


async function undoFinanceYear() {
  if (financeUndoStack.length === 0) {
    alert("Nothing to undo.");
    return;
  }

  const lastState = financeUndoStack.pop();

  try {
    const res = await fetch("/api/finance/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastState),
    });

    if (!res.ok) throw new Error("Undo failed");

    alert("Finance year restored.");
    document.dispatchEvent(new Event("financeUpdated"));

  } catch (err) {
    console.error("Undo error:", err);
    alert("Error restoring finance data.");
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
// ADD UPLOAD BUTTONS (Styled)
// ======================================================
function addUploadButtons() {
  taxGroups.forEach((group) => {
    const container = findGroupContainer(group);
    if (!container) return;

    if (container.querySelector(`[data-upload="${group}"]`)) return;

    const btn = document.createElement("button");
    btn.innerText = "Upload PDF";
    btn.type = "button";
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
      input.accept = ".pdf,application/pdf";
      input.multiple = true;
      input.style.position = "fixed";
      input.style.left = "-9999px";
      input.style.top = "0";
      input.setAttribute("aria-hidden", "true");
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        input.remove();
        window.removeEventListener("focus", handleWindowFocus);
      };

      const handleWindowFocus = () => {
        // If the dialog was dismissed without choosing a file, remove the temp input.
        if (!input.files || input.files.length === 0) cleanup();
      };

      input.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        try {
          await uploadPDFs(files, `${group}-${activeYear}`);
          loadPDFs(group);

          // Update metrics after PDF upload
          document.dispatchEvent(new Event("financeUpdated"));
        } finally {
          cleanup();
        }
      });

      document.body.appendChild(input);
      window.addEventListener("focus", handleWindowFocus, { once: true });
      if (typeof input.showPicker === "function") {
        try {
          input.showPicker();
          return;
        } catch (err) {
          // Fall through to click for browsers that disallow showPicker on hidden inputs.
        }
      }

      input.click();
    };

    container.appendChild(btn);
  });
}

// ======================================================
// UPLOAD
// ======================================================
async function uploadPDFs(files, groupKey) {
  const formData = new FormData();
  files.forEach(file => formData.append("files", file));

  const res = await fetch(`/api/pdf/upload/${groupKey}`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Upload failed${detail ? `: ${detail}` : ""}`);
  }

  return await res.json();
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

    const isMobile = window.innerWidth <= 768;

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

      if (!isMobile) {
        const thumb = document.createElement("embed");
        thumb.src = file.url;
        thumb.type = "application/pdf";
        thumb.width = "100";
        thumb.height = "120";
        thumb.style.borderRadius = "6px";
        card.appendChild(thumb);
      }

      const name = document.createElement("div");
      name.innerText = file.name;
      name.style.fontSize = "12px";
      name.style.marginTop = isMobile ? "2px" : "6px";
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
        document.dispatchEvent(new Event("financeUpdated"));
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
// LISTEN FOR FINANCE UPDATES (Live from Payments, PDFs, Manual Saves, Client Updates)
// ======================================================
document.addEventListener("financeUpdated", () => {
  updateFinanceMetrics();
  taxGroups.forEach((group) => loadPDFs(group));
});

// ======================================================
// AUTO REFRESH METRICS WHEN CLIENT DATA CHANGES
// ======================================================
function refreshFinanceMetrics() {
  document.dispatchEvent(new Event("financeUpdated"));
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
