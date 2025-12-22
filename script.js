function normalizeHeader(s) {
  return String(s || "").trim().toLowerCase();
}

function findCol(headers, candidates) {
  const map = new Map();
  headers.forEach(h => map.set(normalizeHeader(h), h));
  for (const c of candidates) {
    const key = normalizeHeader(c);
    if (map.has(key)) return map.get(key);
  }
  return null;
}

let kpiMap = new Map(); // product(lower) -> kpi revenue
let lastSalesData = []; // lưu sales đã enrich để filter không phải load lại

function isOODRow(row) {
  return String(row["OOD_label"] || "").startsWith("OOD");
}

// ===== UI FILTER =====
function applyFilters() {
  if (!lastSalesData || lastSalesData.length === 0) return;

  const mode = document.getElementById("filterMode")?.value || "all";
  const q = (document.getElementById("searchBox")?.value || "").trim().toLowerCase();

  let filtered = lastSalesData;

  if (mode === "ood") filtered = filtered.filter(isOODRow);
  if (mode === "id") filtered = filtered.filter(r => !isOODRow(r));

  if (q) {
    filtered = filtered.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  }

  renderTable(filtered, true);
}

function resetFilters() {
  const fm = document.getElementById("filterMode");
  const sb = document.getElementById("searchBox");
  if (fm) fm.value = "all";
  if (sb) sb.value = "";
  applyFilters();
}

// ===== RENDER TABLE (chỉ bôi đỏ OOD) =====
function renderTable(data, highlightOOD = false) {
  if (!data || data.length === 0) {
    document.getElementById("output").innerHTML = "<p>Không có dữ liệu.</p>";
    return;
  }

  const MAX_ROWS = 300; // mày có thể tăng/giảm
  const sliced = data.slice(0, MAX_ROWS);

  let html = `<p><b>Hiển thị ${sliced.length} / ${data.length} dòng</b> (giới hạn hiển thị ${MAX_ROWS} dòng để tránh lag)</p>`;
  html += "<table><thead><tr>";

  const headers = Object.keys(sliced[0]);
  headers.forEach(h => (html += `<th>${h}</th>`));
  html += "</tr></thead><tbody>";

  sliced.forEach(row => {
    const ood = highlightOOD && isOODRow(row);

    // ✅ chỉ bôi đỏ đúng dòng OOD
    html += `<tr ${ood ? 'style="background:#ffe5e5;"' : ""}>`;

    headers.forEach(h => {
      const v = row[h] ?? "";
      html += `<td>${v}</td>`;
    });

    html += "</tr>";
  });

  html += "</tbody></table>";
  document.getElementById("output").innerHTML = html;
}

// ===== KPI LOAD (XLSX) =====
async function loadKPI() {
  try {
    const resp = await fetch("kpi_data.xlsx");
    if (!resp.ok) throw new Error("Không tải được KPI XLSX. HTTP " + resp.status);

    const ab = await resp.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array" });

    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });

    // build KPI map (optional)
    kpiMap = new Map();
    if (json.length > 0) {
      const headers = Object.keys(json[0]);
      const colProduct = findCol(headers, ["Tên sản phẩm", "ten san pham", "product", "product_name"]);
      const colKPIRev = findCol(headers, ["KPI doanh thu", "kpi_doanh_thu", "doanh thu kpi", "kpi_revenue", "revenue_kpi", "kpi"]);

      if (colProduct && colKPIRev) {
        json.forEach(r => {
          const p = String(r[colProduct] || "").trim().toLowerCase();
          const k = Number(String(r[colKPIRev] || "0").replaceAll(",", "")) || 0;
          if (p) kpiMap.set(p, k);
        });
      }
    }

    // hiển thị KPI bình thường
    renderTable(json, false);

  } catch (e) {
    document.getElementById("output").innerHTML = "<p>Lỗi đọc KPI XLSX: " + e.message + "</p>";
  }
}

// ===== SALES LOAD (CSV) =====
function loadSales() {
  Papa.parse("sales_data.csv", {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: res => {
      const rows = (res.data || []).filter(r => Object.values(r).some(v => String(v).trim() !== ""));
      lastSalesData = addEOODScore(rows);

      // reset filter UI rồi render
      resetFilters();
    },
    error: err => {
      document.getElementById("output").innerHTML = "<p>Lỗi đọc Sales CSV: " + err + "</p>";
    }
  });
}

// ===== EOOD DEMO SCORING =====
function addEOODScore(rows) {
  if (rows.length === 0) return rows;

  const headers = Object.keys(rows[0]);
  const colProduct = findCol(headers, ["Tên sản phẩm", "ten san pham", "product", "product_name"]);
  const colRevenue = findCol(headers, ["Doanh thu", "doanhthu", "revenue", "sales"]);

  if (!colProduct || !colRevenue) {
    return rows.map(r => ({
      ...r,
      OOD_score: "",
      OOD_label: "ID (in-distribution)"  // thiếu cột thì coi như ID để demo không rỗng
    }));
  }

  const THRESH = 0.5; // lệch KPI > 50% => OOD

  return rows.map(r => {
    const product = String(r[colProduct] || "").trim();
    const productKey = product.toLowerCase();

    const revenue = Number(String(r[colRevenue] || "0").replaceAll(",", "")) || 0;
    const kpi = kpiMap.get(productKey);

    const isNew = product.toLowerCase().includes("(new)") || product.toLowerCase().includes(" new");

    let score = 0;
    let label = "ID (in-distribution)";

    // Rule 1: NEW => OOD luôn
    if (isNew) {
      score = 1;
      label = "OOD: Novel product (New)";
      return { ...r, OOD_score: score.toFixed(3), OOD_label: label };
    }

    // Rule 2: chỉ xét lệch KPI nếu có KPI match
    if (kpi && kpi > 0) {
      score = Math.abs(revenue - kpi) / kpi;
      if (score > THRESH) {
        label = "OOD: High-entropy (KPI deviation)";
      }
    } else {
      // Không có KPI match => coi là ID (để không bị OOD hàng loạt)
      score = 0.05;
      label = "ID (in-distribution)";
    }

    return { ...r, OOD_score: score.toFixed(3), OOD_label: label };
  });
}
