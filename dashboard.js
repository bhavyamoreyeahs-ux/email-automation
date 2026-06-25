const totalContacts = document.querySelector("#totalContacts");
const totalSent = document.querySelector("#totalSent");
const totalReverts = document.querySelector("#totalReverts");
const totalConverted = document.querySelector("#totalConverted");
const dashboardTotalSent = document.querySelector("#dashboardTotalSent");
const outcomePie = document.querySelector("#outcomePie");
const continentPie = document.querySelector("#continentPie");
const outcomeLegend = document.querySelector("#outcomeLegend");
const continentLegend = document.querySelector("#continentLegend");
const continentList = document.querySelector("#continentList");
const dashboardActivity = document.querySelector("#dashboardActivity");
const refreshDashboardButton = document.querySelector("#refreshDashboardButton");
const toast = document.querySelector("#toast");

const colors = ["#1f6feb", "#0891b2", "#15803d", "#b45309", "#7c3aed", "#dc2626", "#64748b"];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

async function apiFetch(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Dashboard data is unavailable.");
  return response.json();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function renderPie(element, legend, rows) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  legend.innerHTML = "";

  if (!total) {
    element.style.background = "#eef2f7";
    element.innerHTML = '<span class="pie-empty">No data</span>';
    legend.innerHTML = '<p class="muted">Data appears after sends, reverts, or sales-forwarded leads are recorded.</p>';
    return;
  }

  let cursor = 0;
  const segments = rows
    .filter((row) => row.value > 0)
    .map((row, index) => {
      const start = cursor;
      const end = cursor + (row.value / total) * 100;
      cursor = end;
      return `${colors[index % colors.length]} ${start}% ${end}%`;
    });

  element.innerHTML = `<span>${formatNumber(total)}</span>`;
  element.style.background = `conic-gradient(${segments.join(", ")})`;

  rows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span style="background:${colors[index % colors.length]}"></span>
      <strong>${row.label}</strong>
      <em>${formatNumber(row.value)}</em>
    `;
    legend.append(item);
  });
}

function renderContinents(continents) {
  continentList.innerHTML = "";

  if (!continents.length) {
    continentList.innerHTML = '<p class="muted">Import contacts with a country or continent column, then send emails to see geography here.</p>';
    return;
  }

  continents.forEach((row) => {
    const total = row.sent + row.simulated;
    const item = document.createElement("div");
    item.className = "continent-card";
    item.innerHTML = `
      <div>
        <strong>${row.continent}</strong>
        <span>${formatNumber(total)} email events</span>
      </div>
      <div class="continent-metrics">
        <span>Sent ${formatNumber(row.sent)}</span>
        <span>Sim ${formatNumber(row.simulated)}</span>
        <span>Reverts ${formatNumber(row.reverts)}</span>
        <span>Sales ${formatNumber(row.converted)}</span>
      </div>
    `;
    continentList.append(item);
  });
}

function renderActivity(events) {
  dashboardActivity.innerHTML = "";

  if (!events.length) {
    dashboardActivity.innerHTML = '<p class="muted">No campaign activity yet.</p>';
    return;
  }

  events.forEach((event) => {
    const item = document.createElement("div");
    item.className = "activity-item";
    item.innerHTML = `
      <div class="activity-content">
        <strong>${event.type.toUpperCase()} - ${event.contactEmail || "No contact"}</strong>
        <span>${event.subject || event.campaignName || "Campaign activity"}</span>
        <span>${new Date(event.createdAt).toLocaleString()}</span>
      </div>
    `;
    dashboardActivity.append(item);
  });
}

async function loadDashboard() {
  try {
    const data = await apiFetch("/api/dashboard");
    const totals = data.totals;
    totalContacts.textContent = formatNumber(totals.contacts);
    totalSent.textContent = formatNumber(totals.sent);
    totalReverts.textContent = formatNumber(totals.reverts);
    totalConverted.textContent = formatNumber(totals.converted);
    dashboardTotalSent.textContent = formatNumber(totals.sent);

    renderPie(outcomePie, outcomeLegend, [
      { label: "Sent", value: totals.sent },
      { label: "Reverts", value: totals.reverts },
      { label: "Forwarded to sales", value: totals.converted },
    ]);

    renderPie(
      continentPie,
      continentLegend,
      data.continents.map((row) => ({ label: row.continent, value: row.sent + row.simulated })),
    );
    renderContinents(data.continents);
    renderActivity(data.recentEvents);
  } catch (error) {
    showToast(error.message);
  }
}

refreshDashboardButton.addEventListener("click", loadDashboard);
loadDashboard();
