function normalizeHeader(s) {
  return String(s || "").trim().toLowerCase();
}

// Tìm tên cột theo nhiều cách viết khác nhau (đỡ lỗi do cột tiếng Việt)
function findCol(headers, candidates) {
  const map = new Map();
  headers.forEach(h => map.set(normalizeHeader(h), h));

  for (const c of candidates) {
    const key = normalizeHeader(c);
    if (map.has(key)) return map.get(key);
  }
  return null;
}

function renderTable(data, highlightOOD = false) {
  if (!data || data.length === 0) {
    document.getElementById("output").innerHTML = "<p>Không có dữ liệu.</p>";
    return;
  }

  const MAX_ROWS = 200;
  const sliced = data.slice(0, MAX_ROWS);

  let html = `<p><b>Hiển thị ${sliced.length} / ${data.length} dòng</b></p>`;
  html += "<table><thead><tr>";

  const headers = Object.keys(sliced[0]);
  headers.forEach(h => (html += `<th>${h}</th>`));
  html += "</tr></thead><tbody>";

  sliced.forEach(row => {
    const isOOD = highlightOOD && String(row["OOD_label"] || "").includes("OOD");

    html += `<tr ${isOOD ? 'style="background:#ffe5e5;"' : ""}>`;
    headers.forEach(h => {
      const v = row[h] ?? "";
      html += `<td>${v}</td>`;
    });
    html += "</tr>";
  });

  html += "</tbody></table>";
  document.getElementById("output").innerHTML = html;
}

// ========== KPI LOAD (XLSX) ==========
let kpiMap = new Map(); 
// key: product name (lower) -> kpi revenue (number)

async function loadKPI() {
  try {
    const resp = await fetch("kpi_data.xlsx");
    if (!resp.ok) throw new Error("Không tải được KPI XLSX. HTTP " + resp.status);

    const ab = await resp.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array" });

    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });

    // Tạo map KPI theo tên sản phẩm
    // Tự dò cột tên sản phẩm + KPI doanh thu
    if (json.length > 0) {
      const headers = Object.keys(json[0]);

      const colProduct = findCol(headers, ["Tên sản phẩm", "ten san pham", "product", "product_name"]);
      const colKPIRev = findCol(headers, ["KPI doanh thu", "kpi_doanh_thu", "doanh thu kpi", "kpi_revenue", "revenue_kpi"]);

      kpiMap = new Map();
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

// ========== SALES LOAD (CSV) ==========
function loadSales() {
  Papa.parse("sales_data.csv", {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: res => {
      const rows = (res.data || []).filter(r => Object.values(r).some(v => String(v).trim() !== ""));
      const enriched = addEOODScore(rows);
      renderTable(enriched, true);
    },
    error: err => {
      document.getElementById("output").innerHTML = "<p>Lỗi đọc Sales CSV: " + err + "</p>";
    }
  });
}

// ========== EOOD DEMO LOGIC ==========
function addEOODScore(rows) {
  if (rows.length === 0) return rows;

  const headers = Object.keys(rows[0]);

  // dò cột tên sản phẩm & doanh thu trong sales
  const colProduct = findCol(headers, ["Tên sản phẩm", "ten san pham", "product", "product_name"]);
  const colRevenue = findCol(headers, ["Doanh thu", "doanhthu", "revenue", "sales"]);

  // nếu không thấy cột quan trọng thì vẫn trả về để khỏi crash
  if (!colProduct || !colRevenue) {
    return rows.map(r => ({
      ...r,
      OOD_score: "",
      OOD_label: "N/A (missing columns)"
    }));
  }

  // ngưỡng demo: lệch KPI > 50% xem như OOD (entropy cao)
  const THRESH = 0.5;

  return rows.map(r => {
    const product = String(r[colProduct] || "").trim();
    const productKey = product.toLowerCase();

    const revenue = Number(String(r[colRevenue] || "0").replaceAll(",", "")) || 0;
    const kpi = kpiMap.get(productKey); // có thể undefined

    // Rule 1: sản phẩm có (New) => OOD
    const isNew = product.toLowerCase().includes("(new)") || product.toLowerCase().includes(" new");

    // Rule 2: lệch KPI => entropy proxy
    let score = 0;
    let reason = [];

    if (kpi && kpi > 0) {
      score = Math.abs(revenue - kpi) / kpi; // lệch tương đối
      if (score > THRESH) reason.push("High-entropy (KPI deviation)");
    } else {
      // nếu không có KPI match, coi như bất định tăng
      score = isNew ? 1 : 0.7;
      reason.push("Unknown KPI (uncertainty)");
    }

    if (isNew) reason.push("Novel product (New)");

    const label = (isNew || score > THRESH) ? `OOD: ${reason.join(" + ")}` : "ID (in-distribution)";

    return {
      ...r,
      OOD_score: score.toFixed(3),
      OOD_label: label
    };
  });
}
