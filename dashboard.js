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
const localEventsKey = "emailAutomationEvents";
const localContactsKey = "emailAutomationContacts";

const colors = ["#1f6feb", "#0891b2", "#15803d", "#b45309", "#7c3aed", "#dc2626", "#64748b"];
const sentTypes = new Set(["sent", "test-sent", "followup-sent"]);
const simulatedTypes = new Set(["simulation", "test-simulation", "followup-simulation"]);

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

function getJson(key, fallback = []) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function mergeById(primary = [], secondary = []) {
  const byId = new Map();
  [...primary, ...secondary].filter((item) => item?.id).forEach((item) => byId.set(item.id, item));
  return [...byId.values()].sort((a, b) => new Date(b.createdAt || b.scheduledAt || 0) - new Date(a.createdAt || a.scheduledAt || 0));
}

function isForwarded(contact) {
  return (
    contact?.converted === true ||
    contact?.forwarded === true ||
    String(contact?.converted || "").toLowerCase() === "true" ||
    String(contact?.forwarded || "").toLowerCase() === "true" ||
    /converted|forwarded|sales|qualified|closed lead|lead closed/i.test(contact?.status || contact?.lifecycle || "")
  );
}

function inferContinent(contact = {}) {
  if (contact.continent) return contact.continent;
  const country = String(contact.country || "").toLowerCase();
  if (/india|singapore|uae|japan|china|asia/.test(country)) return "Asia";
  if (/united states|usa|canada|mexico/.test(country)) return "North America";
  if (/uk|united kingdom|germany|france|netherlands|europe/.test(country)) return "Europe";
  if (/brazil|argentina|chile|south america/.test(country)) return "South America";
  if (/australia|new zealand|oceania/.test(country)) return "Oceania";
  if (/south africa|nigeria|kenya|africa/.test(country)) return "Africa";
  return "Unspecified";
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
    const data = await apiFetch("/api/dashboard").catch(() => ({
      totals: { contacts: 0, sent: 0, simulated: 0, reverts: 0, converted: 0 },
      continents: [],
      recentEvents: [],
    }));
    const apiContacts = await apiFetch("/api/contacts").catch(() => []);
    const localEvents = getJson(localEventsKey);
    const localContacts = getJson(localContactsKey);
    const contacts = mergeById(apiContacts, localContacts);
    const events = mergeById(data.recentEvents || [], localEvents);
    const contactMap = new Map(contacts.map((contact) => [String(contact.email || "").toLowerCase(), contact]));
    const totals = {
      contacts: Math.max(Number(data.totals.contacts || 0), contacts.length),
      sent: events.filter((event) => sentTypes.has(event.type)).length,
      simulated: events.filter((event) => simulatedTypes.has(event.type)).length,
      reverts: Number(data.totals.reverts || 0),
      converted: Math.max(Number(data.totals.converted || 0), contacts.filter(isForwarded).length),
    };
    const continentMap = new Map();
    events.forEach((event) => {
      const contact = contactMap.get(String(event.contactEmail || "").toLowerCase());
      const continent = inferContinent(contact);
      const current = continentMap.get(continent) || { continent, sent: 0, simulated: 0, reverts: 0, converted: 0 };
      if (sentTypes.has(event.type)) current.sent += 1;
      if (simulatedTypes.has(event.type)) current.simulated += 1;
      continentMap.set(continent, current);
    });
    contacts.forEach((contact) => {
      const continent = inferContinent(contact);
      const current = continentMap.get(continent) || { continent, sent: 0, simulated: 0, reverts: 0, converted: 0 };
      if (isForwarded(contact)) current.converted += 1;
      continentMap.set(continent, current);
    });
    const continents = continentMap.size
      ? [...continentMap.values()].sort((a, b) => (b.sent + b.simulated) - (a.sent + a.simulated))
      : data.continents || [];

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
      continents.map((row) => ({ label: row.continent, value: row.sent + row.simulated })),
    );
    renderContinents(continents);
    renderActivity(events.slice(0, 12));
  } catch (error) {
    showToast(error.message);
  }
}

refreshDashboardButton.addEventListener("click", loadDashboard);
loadDashboard();
