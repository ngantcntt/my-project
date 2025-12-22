function renderTable(data) {
  let html = "<table><tr>";
  Object.keys(data[0]).forEach(k => html += `<th>${k}</th>`);
  html += "</tr>";

  data.forEach(row => {
    html += "<tr>";
    Object.values(row).forEach(v => html += `<td>${v}</td>`);
    html += "</tr>";
  });

  html += "</table>";
  document.getElementById("output").innerHTML = html;
}

function loadSales() {
  Papa.parse("sale_data_2024.csv", {
    download: true,
    header: true,
    complete: res => renderTable(res.data)
  });
}

function loadKPI() {
  Papa.parse("sale_data_kpi.csv", {
    download: true,
    header: true,
    complete: res => renderTable(res.data)
  });
}
