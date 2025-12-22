function renderTable(data) {
  // data: array of objects
  if (!data || data.length === 0) {
    document.getElementById("output").innerHTML = "<p>Không có dữ liệu.</p>";
    return;
  }

  // Giới hạn hiển thị để đỡ lag (mày chỉnh số này tuỳ)
  const MAX_ROWS = 200;
  const sliced = data.slice(0, MAX_ROWS);

  let html = "<p><b>Hiển thị " + sliced.length + " / " + data.length + " dòng</b></p>";
  html += "<table><thead><tr>";

  const headers = Object.keys(sliced[0]);
  headers.forEach(h => (html += `<th>${h}</th>`));
  html += "</tr></thead><tbody>";

  sliced.forEach(row => {
    html += "<tr>";
    headers.forEach(h => {
      const v = row[h] ?? "";
      html += `<td>${v}</td>`;
    });
    html += "</tr>";
  });

  html += "</tbody></table>";
  document.getElementById("output").innerHTML = html;
}

// ===== SALES: đọc CSV (đang có sales_data.csv) =====
function loadSales() {
  Papa.parse("sales_data.csv", {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: res => {
      // lọc dòng rỗng
      const cleaned = (res.data || []).filter(r => Object.values(r).some(v => String(v).trim() !== ""));
      renderTable(cleaned);
    },
    error: err => {
      document.getElementById("output").innerHTML = "<p>Lỗi đọc sales CSV: " + err + "</p>";
    }
  });
}

// ===== KPI: đọc XLSX (đang có kpi_data.xlsx) =====
async function loadKPI() {
  try {
    const resp = await fetch("kpi_data.xlsx");
    if (!resp.ok) throw new Error("Không tải được file KPI XLSX. HTTP " + resp.status);

    const ab = await resp.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array" });

    // Lấy sheet đầu tiên
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    // Convert sheet → array of objects
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });

    renderTable(json);
  } catch (e) {
    document.getElementById("output").innerHTML = "<p>Lỗi đọc KPI XLSX: " + e.message + "</p>";
  }
}
