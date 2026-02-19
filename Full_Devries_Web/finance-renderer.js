// ======================================================
// FINANCE PAGE RENDERER (Fixed - Correct API Path)
// ======================================================

// DOM references
const financeTableBody = document.getElementById("metricsBody");
const taxGroups = ["w9", "pnl", "1099", "inference"];
const yearSelector = document.getElementById("finance-year");

// Keep track of active year
let activeYear = new Date().getFullYear();

// ======================================================
// FETCH FINANCE SUMMARY
// ======================================================
async function fetchFinanceSummary(year) {
  try {
    // ✅ FIXED ROUTE HERE
    const res = await fetch(`/api/finance/summary?year=${year}`);

    if (!res.ok) throw new Error("Failed to fetch finance summary");

    return await res.json();
  } catch (err) {
    console.error("Error fetching finance summary:", err);
    return null;
  }
}

// ======================================================
// UPDATE FINANCE METRICS
// ======================================================
async function updateFinanceMetrics() {
  try {
    if (!financeTableBody) return;

    const summary = await fetchFinanceSummary(activeYear);

    if (!summary) {
      financeTableBody.innerHTML =
        "<tr><td colspan='5'>No clients found</td></tr>";
      return;
    }

    financeTableBody.innerHTML = `
      <tr>
        <td>${summary.year}</td>
        <td style="color:black;">$${Number(summary.totalExpected || 0).toLocaleString()}</td>
        <td>$${Number(summary.totalReceived || 0).toLocaleString()}</td>
        <td>$${Number(summary.totalRemaining || 0).toLocaleString()}</td>
        <td>${summary.totalClients || 0} clients</td>
      </tr>
    `;
  } catch (err) {
    console.error("Error loading finance data:", err);
    if (financeTableBody)
      financeTableBody.innerHTML =
        "<tr><td colspan='5'>Failed to load data</td></tr>";
  }
}

// ======================================================
// YEAR SELECTOR LOGIC
// ======================================================
if (yearSelector) {
  yearSelector.value = activeYear;

  yearSelector.addEventListener("change", (e) => {
    activeYear =
      parseInt(e.target.value) || new Date().getFullYear();
    updateFinanceMetrics();
  });
}

// ======================================================
// PDF DROP ZONE FOR TAX DOCS
// ======================================================
taxGroups.forEach((group) => {
  const dz = document
    .getElementById(`${group}-group`)
    ?.querySelector(".drop-zone");

  const listContainer = document.getElementById(
    `${group}-list`
  );

  if (!dz) return;

  ["dragover", "dragleave", "drop"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.toggle("dragover", evt === "dragover");
    })
  );

  dz.addEventListener("drop", async (e) => {
    const files = e.dataTransfer.files;
    if (!files.length) return;

    for (let file of files) {
      await uploadPDF(file, `${group}-${activeYear}`);
    }

    alert(
      `✅ ${files.length} file(s) uploaded to ${group.toUpperCase()} for ${activeYear}`
    );

    loadPDFs(group, listContainer);
  });
});

// ======================================================
// UPLOAD PDF FUNCTION
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
    console.error("Error uploading PDF:", err);
  }
}

// ======================================================
// LOAD PDFs INTO DROP ZONE LIST
// ======================================================
async function loadPDFs(group, container) {
  if (!container) return;

  container.innerHTML = "";

  try {
    const res = await fetch(
      `/api/pdf/list/${group}-${activeYear}`
    );

    if (!res.ok) throw new Error("Failed to list PDFs");

    const data = await res.json();

    if (!data.files || data.files.length === 0) {
      container.innerHTML =
        `<div style="color:#888; font-size:13px;">No PDFs uploaded yet.</div>`;
      return;
    }

    data.files.forEach((file) => {
      const div = document.createElement("div");
      div.className = "pdf-item";
      div.dataset.url = file.url;
      div.innerText = file.name;
      container.appendChild(div);
    });
  } catch (err) {
    console.error(
      `Error loading PDFs for ${group}:`,
      err
    );
  }
}

// ======================================================
// PDF MODAL LOGIC
// ======================================================
{
  const pdfModal = document.getElementById("pdfModal");
  const pdfViewer = document.getElementById("pdfViewer");
  const pdfModalClose =
    document.getElementById("pdfModalClose");

  if (pdfModalClose) {
    pdfModalClose.addEventListener("click", () => {
      if (pdfModal) pdfModal.style.display = "none";
      if (pdfViewer) pdfViewer.innerHTML = "";
    });
  }

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("pdf-item")) {
      const url = e.target.dataset.url;
      if (!url) return;
      openPDFModal(url);
    }

    if (e.target === pdfModal) {
      if (pdfModal) pdfModal.style.display = "none";
      if (pdfViewer) pdfViewer.innerHTML = "";
    }
  });

  async function openPDFModal(url) {
    if (!pdfViewer || !pdfModal) return;

    pdfViewer.innerHTML = "";
    pdfModal.style.display = "flex";

    const loadPDF = async (data) => {
      const pdf = await pdfjsLib
        .getDocument({ data })
        .promise;

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({
          scale: 1.5,
        });

        const canvas = document.createElement(
          "canvas"
        );

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        pdfViewer.appendChild(canvas);

        const ctx = canvas.getContext("2d");

        await page.render({
          canvasContext: ctx,
          viewport,
        }).promise;
      }
    };

    fetch(url)
      .then((r) => r.arrayBuffer())
      .then(loadPDF)
      .catch((err) =>
        console.error("Failed to load PDF:", err)
      );
  }
}

// ======================================================
// INITIAL LOAD
// ======================================================
updateFinanceMetrics();

taxGroups.forEach((group) => {
  const container =
    document.getElementById(`${group}-list`);
  loadPDFs(group, container);
});
