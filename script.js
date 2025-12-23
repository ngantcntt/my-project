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

// ===== GLOBAL STATE =====
let kpiMap = new Map();         // product(lower) -> KPI revenue
let lastSalesData = [];         // sales enriched
let salesStatsByProduct = {};   // product(lower) -> {mean, std}

// ===== OOD TYPE HELPERS =====
function isOODRow(row) {
  return String(row["OOD_type"] || "") !== "" && String(row["OOD_type"]).toUpperCase() !== "ID";
}

function rowColor(row) {
  const t = String(row["OOD_type"] || "ID").toUpperCase();
  if (t === "NEW") return "#ffe5e5";       // đỏ nhạt
  if (t === "KPI") return "#fff0d9";       // cam nhạt
  if (t === "SPIKE") return "#fff9cc";     // vàng nhạt
  return "";
}

// ===== UI FILTER =====
function applyFilters() {
  if (!lastSalesData || lastSalesData.length === 0) {
    document.getElementById("output").innerHTML = "<p>Chưa có dữ liệu Sales. Bấm “Xem Sales (CSV)”.</p>";
    return;
  }

  const mode = document.getElementById("filterMode")?.value || "all";     // all/ood/id
  const typeMode = document.getElementById("typeMode")?.value || "all";   // all/NEW/KPI/SPIKE
  const q = (document.getElementById("searchBox")?.value || "").trim().toLowerCase();

  let filtered = lastSalesData;

  if (mode === "ood") filtered = filtered.filter(isOODRow);
  if (mode === "id") filtered = filtered.filter(r => !isOODRow(r));

  if (typeMode !== "all") {
    filtered = filtered.filter(r => String(r["OOD_type"] || "").toUpperCase() === typeMode);
  }

  if (q) {
    filtered = filtered.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  }

  renderTable(filtered, true);
}

function resetFilters() {
  const fm = document.getElementById("filterMode");
  const tm = document.getElementById("typeMode");
  const sb = document.getElementById("searchBox");
  if (fm) fm.value = "all";
  if (tm) tm.value = "all";
  if (sb) sb.value = "";
  applyFilters();
}

// ===== RENDER TABLE =====
function renderTable(data, highlightOOD = false) {
  if (!data || data.length === 0) {
    document.getElementById("output").innerHTML = "<p>Không có dữ liệu.</p>";
    return;
  }

  const MAX_ROWS = 300;
  const sliced = data.slice(0, MAX_ROWS);

  let html = `<p><b>Hiển thị ${sliced.length} / ${data.length} dòng</b> (giới hạn ${MAX_ROWS} dòng để tránh lag)</p>`;
  html += "<table><thead><tr>";

  // Ẩn các cột tên sản phẩm và chỉ hiển thị cột OOD_type và OOD_score
  html += `<th>OOD Type</th><th>OOD Score</th>`;
  html += "</tr></thead><tbody>";

  sliced.forEach(row => {
    const ood = highlightOOD && isOODRow(row);
    const bg = ood ? rowColor(row) : "";
    html += `<tr ${bg ? `style="background:${bg};"` : ""}>`;

    // Chỉ hiển thị OOD type và OOD score
    html += `<td>${row["OOD_type"] || ""}</td><td>${row["OOD_score"] || ""}</td>`;

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

    kpiMap = new Map();

    if (json.length > 0) {
      const headers = Object.keys(json[0]);
      const colProduct = findCol(headers, ["Tên sản phẩm", "ten san pham", "product", "product_name"]);
      const colKPIRev = findCol(headers, ["KPI doanh thu", "doanh thu kpi", "kpi_revenue", "revenue_kpi", "kpi"]);

      if (colProduct && colKPIRev) {
        json.forEach(r => {
          const p = String(r[colProduct] || "").trim().toLowerCase();
          const k = Number(String(r[colKPIRev] || "0").replaceAll(",", "")) || 0;
          if (p) kpiMap.set(p, k);
        });
      }
    }

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
      lastSalesData = enrichEOOD(rows);

      // reset filter rồi render
      resetFilters();
    },
    error: err => {
      document.getElementById("output").innerHTML = "<p>Lỗi đọc Sales CSV: " + err + "</p>";
    }
  });
}

// ===== CORE: EOOD DEMO ENRICH =====
function enrichEOOD(rows) {
  if (rows.length === 0) return rows;

  const headers = Object.keys(rows[0]);

  // auto-detect columns
  const colProduct = findCol(headers, ["Tên sản phẩm", "ten san pham", "product", "product_name"]);
  const colRevenue = findCol(headers, ["Doanh thu", "doanhthu", "revenue", "sales"]);
  const colMonth = findCol(headers, ["Tháng", "thang", "month"]);

  if (!colProduct || !colRevenue) {
    // fallback: không đủ cột => coi như ID
    return rows.map(r => ({
      ...r,
      OOD_score: "0.000",
      OOD_type: "ID",
      OOD_label: "ID (missing columns)"
    }));
  }

  // 1) Tính stats theo product để phát hiện spike/drop
  salesStatsByProduct = computeStatsByProduct(rows, colProduct, colRevenue);

  // thresholds (demo)
  const KPI_THRESH = 0.5;    // lệch KPI 50% => OOD (KPI)
  const Z_SPIKE = 3.0;       // z-score > 3 => OOD (SPIKE) (proxy mùa vụ/khuyến mãi)

  return rows.map(r => {
    const product = String(r[colProduct] || "").trim();
    const pkey = product.toLowerCase();

    const revenue = Number(String(r[colRevenue] || "0").replaceAll(",", "")) || 0;
    const month = colMonth ? String(r[colMonth] || "").trim() : "";

    const isNew = product.toLowerCase().includes("(new)") || product.toLowerCase().includes(" new");

    // ===== RULE A: NEW =====
    if (isNew) {
      return {
        ...r,
        OOD_score: "1.000",
        OOD_type: "NEW",
        OOD_label: "OOD: Novelty (New product)"
      };
    }

    // ===== RULE B: KPI deviation (nếu match được KPI) =====
    const kpi = kpiMap.get(pkey);
    if (kpi && kpi > 0) {
      const dev = Math.abs(revenue - kpi) / kpi;
      if (dev > KPI_THRESH) {
        return {
          ...r,
          OOD_score: dev.toFixed(3),
          OOD_type: "KPI",
          OOD_label: `OOD: High-entropy (KPI deviation)${month ? ` | month=${month}` : ""}`
        };
      }
    }

    // ===== RULE C: Spike/Drop theo phân phối lịch sử (z-score) =====
    const st = salesStatsByProduct[pkey];
    if (st && st.std > 0) {
      const z = Math.abs(revenue - st.mean) / st.std;
      if (z > Z_SPIKE) {
        return {
          ...r,
          OOD_score: z.toFixed(3),
          OOD_type: "SPIKE",
          OOD_label: `OOD: Spike/Drop (seasonality/promo proxy)${month ? ` | month=${month}` : ""}`
        };
      }
    }

    // ===== ID =====
    return {
      ...r,
      OOD_score: "0.050",
      OOD_type: "ID",
      OOD_label: "ID (in-distribution)"
    };
  });
}

function computeStatsByProduct(rows, colProduct, colRevenue) {
  // mean & std per product
  const acc = {};
  rows.forEach(r => {
    const product = String(r[colProduct] || "").trim().toLowerCase();
    const revenue = Number(String(r[colRevenue] || "0").replaceAll(",", "")) || 0;
    if (!product) return;
    if (!acc[product]) acc[product] = [];
    acc[product].push(revenue);
  });

  const stats = {};
  Object.keys(acc).forEach(p => {
    const arr = acc[p];
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const varr = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1);
    const std = Math.sqrt(varr);
    stats[p] = { mean, std };
  });

  return stats;
}
