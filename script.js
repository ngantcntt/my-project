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

  const MAX_ROWS = 20;
  const sliced = data.slice(0, MAX_ROWS);

  let html = `<p><b>Hiển thị ${sliced.length} / ${data.length} dòng</b> (giới hạn ${MAX_ROWS} dòng để tránh lag)</p>`;
  html += "<table><thead><tr>";

  // Hiển thị tất cả các cột trong dữ liệu
  const headers = Object.keys(sliced[0]);
  headers.forEach(h => {
    html += `<th>${h}</th>`;
  });
  html += "</tr></thead><tbody>";

  sliced.forEach(row => {
    const ood = highlightOOD && isOODRow(row);
    const bg = ood ? rowColor(row) : "";
    html += `<tr ${bg ? `style="background:${bg};"` : ""}>`;

    // Hiển thị tất cả các cột dữ liệu cho mỗi dòng
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
  // Dữ liệu KPI giả lập
  const data = [
    { product: "Giấy vệ sinh Smor túi 10 cuộn 1.4kg dài", kpi_revenue: 500000 },
    { product: "Bột giặt Polar Bear đỏ 2,25kg", kpi_revenue: 300000 },
    { product: "Bột giặt Polar Bear đỏ 6 Kg", kpi_revenue: 700000 },
  ];

  data.forEach(r => {
    const p = String(r.product || "").trim().toLowerCase();
    const k = Number(r.kpi_revenue) || 0;
    if (p) kpiMap.set(p, k);
  });

  renderTable(data, false);
}

// ===== SALES LOAD (CSV) =====
function loadSales() {
  // Dữ liệu Sales giả lập
  const fakeSalesData = [
    { year: 2024, month: 4, region: "BD Tỉnh Lào Cai", city: "BĐH Bắc Hà - Lào Cai", category: "Chăm sóc cá nhân", product: "Giấy vệ sinh Smor túi 10 cuộn 1.4kg dài", quantity: 4, revenue: 304000, OOD_score: 0.050, OOD_type: "ID", OOD_label: "ID (in-distribution)" },
    { year: 2024, month: 4, region: "BD Tỉnh Lào Cai", city: "BĐH Bắc Hà - Lào Cai", category: "Chăm sóc gia đình", product: "Bột giặt Polar Bear đỏ 2,25kg", quantity: 4, revenue: 298000, OOD_score: 0.050, OOD_type: "ID", OOD_label: "ID (in-distribution)" },
    { year: 2024, month: 4, region: "BD Tỉnh Lào Cai", city: "BĐH Bắc Hà - Lào Cai", category: "Chăm sóc gia đình", product: "Bột giặt Polar Bear đỏ 6 Kg", quantity: 5, revenue: 970000, OOD_score: 0.050, OOD_type: "ID", OOD_label: "ID (in-distribution)" },
    { year: 2024, month: 4, region: "BD Tỉnh Lào Cai", city: "BĐH Bắc Hà - Lào Cai", category: "Chăm sóc gia đình", product: "Lau sàn Polar Bear 1,5 Kg LiLy (8Chai/Thùng)", quantity: 7, revenue: 420000, OOD_score: 0.050, OOD_type: "ID", OOD_label: "ID (in-distribution)" },
  ];

  lastSalesData = enrichEOOD(fakeSalesData);
  resetFilters();
}

// ===== CORE: EOOD DEMO ENRICH =====
function enrichEOOD(rows) {
  if (rows.length === 0) return rows;

  const headers = Object.keys(rows[0]);

  // auto-detect columns
  const colProduct = findCol(headers, ["Tên sản phẩm", "ten san pham", "product", "product_name"]);
  const colRevenue = findCol(headers, ["Doanh thu", "doanhthu", "revenue", "sales"]);

  // thresholds (demo)
  const KPI_THRESH = 0.2;    // Giảm ngưỡng lệch KPI từ 50% xuống 20%
  const Z_SPIKE = 3.0;       // z-score > 3 => OOD (SPIKE)

  return rows.map(r => {
    const product = String(r[colProduct] || "").trim();
    const pkey = product.toLowerCase();

    const revenue = Number(String(r[colRevenue] || "0").replaceAll(",", "")) || 0;

    // Phân loại sản phẩm mới
    const isNew = Math.random() > 0.5; // Sử dụng ngẫu nhiên để giả lập phân loại sản phẩm mới

    if (isNew) {
      return {
        ...r,
        OOD_score: "1.000",
        OOD_type: "NEW",
        OOD_label: "OOD: Novelty (New product)"
      };
    }

    // KPI deviation (giả lập lệch KPI)
    const kpi = kpiMap.get(pkey);
    if (kpi && kpi > 0) {
      const dev = Math.abs(revenue - kpi) / kpi;
      if (dev > KPI_THRESH) {
        return {
          ...r,
          OOD_score: dev.toFixed(3),
          OOD_type: "KPI",
          OOD_label: `OOD: High-entropy (KPI deviation)`
        };
      }
    }

    // SPIKE
    if (Math.random() > 0.8) {  // Giả lập spike
      return {
        ...r,
        OOD_score: "1.000",
        OOD_type: "SPIKE",
        OOD_label: "OOD: Spike/Drop"
      };
    }

    // Default: ID
    return {
      ...r,
      OOD_score: "0.050",
      OOD_type: "ID",
      OOD_label: "ID (in-distribution)"
    };
  });
}
