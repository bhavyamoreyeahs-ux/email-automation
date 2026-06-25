const toast = document.querySelector("#toast");
const campaignKey = "emailAutomationCampaign";
const setupKey = "emailAutomationSetup";
const sessionKey = "emailAutomationSession";
const localEventsKey = "emailAutomationEvents";
const localContactsKey = "emailAutomationContacts";
const orderedPages = ["setup.html", "mailbox.html", "audience.html", "campaign.html", "launch.html"];

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

async function apiFetch(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: /<[^>]+>/.test(text) ? "" : text };
    }
    const apiMissing = path.startsWith("/api/") && response.status === 404;
    const fallback = apiMissing
      ? "Backend API is not available on this deployment yet. Redeploy the latest version and try again."
      : response.status >= 500
        ? "Server error. Please try again, or check the SMTP connection."
        : `Request failed (${response.status}).`;
    throw new Error((body.issues || [apiMissing ? fallback : body.message || fallback]).join(" "));
  }
  return response.json();
}

function getJson(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function setJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function mergeEvents(events = []) {
  const existing = getJson(localEventsKey, []);
  const byId = new Map(existing.map((event) => [event.id, event]));
  events.filter((event) => event?.id).forEach((event) => byId.set(event.id, event));
  setJson(
    localEventsKey,
    [...byId.values()]
      .sort((a, b) => new Date(b.createdAt || b.scheduledAt || 0) - new Date(a.createdAt || a.scheduledAt || 0))
      .slice(0, 200),
  );
}

function mergedEvents(apiEvents = []) {
  const byId = new Map();
  [...apiEvents, ...getJson(localEventsKey, [])].filter((event) => event?.id).forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((a, b) => new Date(b.createdAt || b.scheduledAt || 0) - new Date(a.createdAt || a.scheduledAt || 0));
}

function fallbackEventsFromResults(result, campaign, typePrefix = "") {
  const eventType = `${typePrefix}${result.mode === "smtp" ? "sent" : "simulation"}`;
  return (result.results || []).map((delivery, index) => ({
    id: `local_${eventType}_${Date.now()}_${index}_${String(delivery.to || "").replace(/[^a-z0-9]/gi, "_")}`,
    type: eventType,
    contactEmail: delivery.to,
    campaignName: campaign?.offer || "Campaign",
    subject: delivery.subject || campaign?.emails?.[0]?.subject || "Campaign activity",
    createdAt: new Date().toISOString(),
  }));
}

function currentPage() {
  return window.location.pathname.split("/").pop() || "index.html";
}

async function getProgress() {
  const status = await apiFetch("/api/status").catch(() => ({
    mailConfigured: false,
    contactCount: 0,
  }));
  const setup = getJson(setupKey, {});
  const campaign = getJson(campaignKey);
  return {
    loggedIn: Boolean(getJson(sessionKey)),
    setup: Boolean(setup.offer && setup.audience && setup.proof),
    mailbox: Boolean(status.mailConfigured),
    audience: Number(status.contactCount || 0) > 0,
    campaign: Boolean(campaign?.emails?.length),
  };
}

function firstIncompletePage(progress) {
  if (!progress.setup) return "setup.html";
  if (!progress.mailbox) return "mailbox.html";
  if (!progress.audience) return "audience.html";
  if (!progress.campaign) return "campaign.html";
  return "launch.html";
}

async function enforceJourneyOrder() {
  const page = currentPage();
  if (page === "login.html") return;

  const progress = await getProgress();
  if (!progress.loggedIn) {
    window.location.href = "login.html";
    return;
  }

  const requiredByPage = {
    "mailbox.html": progress.setup,
    "audience.html": progress.setup && progress.mailbox,
    "campaign.html": progress.setup && progress.mailbox && progress.audience,
    "launch.html": progress.setup && progress.mailbox && progress.audience && progress.campaign,
  };

  if (requiredByPage[page] === false) {
    window.location.href = firstIncompletePage(progress);
    return;
  }

  renderJourneyCards(progress);
}

function renderJourneyCards(progress) {
  const cards = [...document.querySelectorAll("[data-step-card]")];
  if (!cards.length) return;

  const availability = {
    setup: true,
    mailbox: progress.setup,
    audience: progress.setup && progress.mailbox,
    campaign: progress.setup && progress.mailbox && progress.audience,
    launch: progress.setup && progress.mailbox && progress.audience && progress.campaign,
  };
  const complete = {
    setup: progress.setup,
    mailbox: progress.mailbox,
    audience: progress.audience,
    campaign: progress.campaign,
    launch: false,
  };

  cards.forEach((card) => {
    const step = card.dataset.stepCard;
    card.classList.toggle("locked", !availability[step]);
    card.classList.toggle("complete", complete[step]);
    card.addEventListener("click", (event) => {
      if (!availability[step]) {
        event.preventDefault();
        showToast("Complete the previous step first.");
      }
    });
  });
}

function buildEmailFooter(goal, offer) {
  const ctas = {
    "Book discovery calls": "Would it be useful to compare your current setup against the fastest wins we usually find?",
    "Promote a webinar": "Want me to save you a seat for the live walkthrough?",
    "Nurture cold leads": "Should I send over the short checklist our team uses before a nurture sequence goes live?",
    "Win back inactive buyers": "Would you be open to seeing what changed since the last time we spoke?",
  };
  return `\n\n${ctas[goal] || "Would it be helpful to explore the next step together?"}\n\nBest,\n[Your name]\n[Your role / company]\n[Your email]`;
}

function createCampaignFromSetup(setup) {
  const proof = setup.proof.replace(/\.$/, "");
  const emails = [
    {
      timing: "Send immediately",
      score: 91,
      subject: `{{company}}: practical next steps for ${setup.offer}`,
      body: `Hi {{firstName}},\n\nWe help ${setup.audience} evaluate whether ${setup.offer} is the right next step.\n\nThe strongest fit is usually where teams need a clear path from current challenges to measurable outcomes: ${proof.toLowerCase()}.${buildEmailFooter(setup.goal, setup.offer)}`,
    },
    {
      timing: "Manual follow-up",
      score: 88,
      followupMode: "manual",
      followupDelayDays: 2,
      subject: `Where {{industry}} teams usually find quick wins`,
      body: `Hi {{firstName}},\n\nA useful first conversation usually shows what problem is worth solving first, which blockers are slowing progress, and what a practical next step should look like.${buildEmailFooter(setup.goal, setup.offer)}`,
    },
    {
      timing: "Manual follow-up",
      score: 84,
      followupMode: "manual",
      followupDelayDays: 5,
      subject: "Should I close the loop?",
      body: `Hi {{firstName}},\n\nI did not want to keep filling your inbox if ${setup.offer} is not active for {{company}} right now.${buildEmailFooter(setup.goal, setup.offer)}`,
    },
  ];
  return {
    id: `campaign_${Date.now()}`,
    offer: setup.offer,
    audience: setup.audience,
    goal: setup.goal,
    voice: setup.voice,
    proof: setup.proof,
    ctaUrl: "",
    emails,
    recommendations: [],
  };
}

function parseCsv(csv) {
  if (!csv.trim()) return [];
  const rows = csv.trim().split(/\r?\n/).map((row) => row.split(",").map((value) => value.trim()));
  const headers = rows.shift() || [];
  return rows.filter((row) => row.some(Boolean)).map((row) =>
    headers.reduce((contact, header, index) => {
      const value = row[index] || "";
      if (header === "consent") {
        contact[header] = value.toLowerCase() !== "false";
      } else if (header === "forwarded") {
        contact[header] = value.toLowerCase() === "true";
      } else {
        contact[header] = value;
      }
      return contact;
    }, {}),
  );
}

function parseRecipients(value) {
  return [...new Set(String(value || "").split(/[\n,;]/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

document.querySelector("#loginForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  setJson(sessionKey, {
    email: document.querySelector("#loginEmailInput").value.trim(),
    workspace: document.querySelector("#workspaceNameInput").value.trim(),
    signedInAt: new Date().toISOString(),
  });
  window.location.href = "index.html";
});

enforceJourneyOrder();

const setupForm = document.querySelector("#setupForm");
if (setupForm) {
  const setup = getJson(setupKey, {});
  ["offer", "audience", "proof"].forEach((field) => {
    const input = document.querySelector(`#${field}Input`);
    if (input) input.value = setup[field] || "";
  });
  if (setup.goal) document.querySelector("#goalInput").value = setup.goal;
  if (setup.voice) document.querySelector("#voiceInput").value = setup.voice;
  document.querySelector("#fromNameInput").value = setup.fromName || "";
  document.querySelector("#replyToInput").value = setup.replyTo || "";

  setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextSetup = {
      offer: document.querySelector("#offerInput").value.trim(),
      audience: document.querySelector("#audienceInput").value.trim(),
      goal: document.querySelector("#goalInput").value,
      voice: document.querySelector("#voiceInput").value,
      proof: document.querySelector("#proofInput").value.trim(),
      fromName: document.querySelector("#fromNameInput").value.trim(),
      replyTo: document.querySelector("#replyToInput").value.trim(),
    };
    setJson(setupKey, nextSetup);
    setJson(campaignKey, createCampaignFromSetup(nextSetup));
    window.location.href = "mailbox.html";
  });
}

const mailboxForm = document.querySelector("#mailboxForm");
if (mailboxForm) {
  const smtpPortInput = document.querySelector("#smtpPortInput");
  const smtpSecureInput = document.querySelector("#smtpSecureInput");
  const syncSecureWithPort = () => {
    const port = Number(smtpPortInput.value);
    if (port === 587) smtpSecureInput.checked = false;
    if (port === 465) smtpSecureInput.checked = true;
  };

  apiFetch("/api/mail/config").then((config) => {
    document.querySelector("#smtpHostInput").value = config.smtpHost || "";
    smtpPortInput.value = config.smtpPort || 587;
    document.querySelector("#smtpUserInput").value = config.smtpUser || "";
    document.querySelector("#fromNameInput").value = config.fromName || "";
    document.querySelector("#fromEmailInput").value = config.fromEmail || "";
    document.querySelector("#replyToInput").value = config.replyTo || "";
    document.querySelector("#companyAddressInput").value = config.address || "";
    smtpSecureInput.checked = Boolean(config.smtpSecure);
    syncSecureWithPort();
  }).catch(() => {});

  smtpPortInput.addEventListener("input", syncSecureWithPort);

  mailboxForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      syncSecureWithPort();
      await apiFetch("/api/mail/connect", {
        method: "POST",
        body: JSON.stringify({
          smtpHost: document.querySelector("#smtpHostInput").value.trim(),
          smtpPort: smtpPortInput.value,
          smtpUser: document.querySelector("#smtpUserInput").value.trim(),
          smtpPass: document.querySelector("#smtpPasswordInput").value,
          smtpSecure: smtpSecureInput.checked,
          fromName: document.querySelector("#fromNameInput").value.trim(),
          fromEmail: document.querySelector("#fromEmailInput").value.trim(),
          replyTo: document.querySelector("#replyToInput").value.trim(),
          address: document.querySelector("#companyAddressInput").value.trim(),
        }),
      });
      showToast("Mailbox verified and saved.");
      window.setTimeout(() => (window.location.href = "audience.html"), 700);
    } catch (error) {
      showToast(error.message);
    }
  });
}

document.querySelector("#uploadCsvButton")?.addEventListener("click", () => document.querySelector("#csvFileInput").click());
document.querySelector("#csvFileInput")?.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  try {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    let contents = "";

    if (["xlsx", "xls", "xlsm"].includes(extension)) {
      if (!window.XLSX) {
        throw new Error("Excel parser is unavailable. Please try again or upload CSV.");
      }
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      contents = window.XLSX.utils.sheet_to_csv(worksheet);
    } else {
      contents = await file.text();
    }

    document.querySelector("#contactsInput").value = contents.replace(/^\uFEFF/, "");
    showToast(`Loaded ${file.name}`);
  } catch (error) {
    showToast(error.message || "Could not read the selected file.");
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#importContactsButton")?.addEventListener("click", async () => {
  try {
    const contacts = parseCsv(document.querySelector("#contactsInput").value);
    const result = await apiFetch("/api/contacts/import", { method: "POST", body: JSON.stringify({ contacts }) });
    setJson(localContactsKey, result.contacts || contacts);
    document.querySelector("#contactImportStatus").textContent = `${result.activeContacts} active contacts imported`;
    showToast("Contacts imported and segmented.");
  } catch (error) {
    showToast(error.message);
  }
});

function renderCampaignEditor() {
  const container = document.querySelector("#campaignDraftEditor");
  if (!container) return;
  const campaign = getJson(campaignKey);
  if (!campaign?.emails?.length) {
    container.innerHTML = '<p class="muted">No campaign yet. Complete Setup first.</p>';
    return;
  }
  container.innerHTML = "";
  campaign.emails.forEach((email, index) => {
    const block = document.createElement("div");
    block.className = "manual-draft-editor";
    block.innerHTML = `
      <h3>Email ${index + 1}</h3>
      <label>Subject<input data-subject="${index}" value="${email.subject.replaceAll('"', "&quot;")}" /></label>
      <label>Body<textarea rows="9" data-body="${index}">${email.body}</textarea></label>
    `;
    container.append(block);
  });
}

function saveCampaignEditor() {
  const campaign = getJson(campaignKey);
  if (!campaign) return null;
  document.querySelectorAll("[data-subject]").forEach((input) => {
    campaign.emails[Number(input.dataset.subject)].subject = input.value.trim();
  });
  document.querySelectorAll("[data-body]").forEach((input) => {
    campaign.emails[Number(input.dataset.body)].body = input.value.trim();
  });
  if (campaign.emails[1]) {
    campaign.emails[1].followupMode = document.querySelector("#followupOneMode")?.value || "manual";
    campaign.emails[1].followupDelayDays = Number(document.querySelector("#followupOneDays")?.value || 2);
  }
  if (campaign.emails[2]) {
    campaign.emails[2].followupMode = document.querySelector("#followupTwoMode")?.value || "manual";
    campaign.emails[2].followupDelayDays = Number(document.querySelector("#followupTwoDays")?.value || 5);
  }
  setJson(campaignKey, campaign);
  return campaign;
}

renderCampaignEditor();
document.querySelector("#regenerateCampaignButton")?.addEventListener("click", () => {
  const setup = getJson(setupKey);
  if (!setup?.offer) return showToast("Complete setup first.");
  setJson(campaignKey, createCampaignFromSetup(setup));
  renderCampaignEditor();
  showToast("Campaign regenerated.");
});
document.querySelector("#sendTestButton")?.addEventListener("click", async () => {
  const campaign = saveCampaignEditor();
  const recipients = parseRecipients(document.querySelector("#testRecipientsInput").value);
  if (!campaign) return showToast("Complete setup first.");
  if (!recipients.length) return showToast("Add at least one test recipient.");
  try {
    const result = await apiFetch("/api/test/send", { method: "POST", body: JSON.stringify({ campaign, recipients }) });
    mergeEvents((result.events || []).length ? result.events : fallbackEventsFromResults(result, campaign, "test-"));
    showToast(result.partialFailure ? `${result.processed} sent, ${result.failures.length} failed.` : `${result.mode === "smtp" ? "Sent" : "Simulated"} ${result.processed} test emails.`);
  } catch (error) {
    showToast(error.message);
  }
});

async function renderLaunchActivity() {
  const activityLog = document.querySelector("#activityLog");
  if (!activityLog) return;
  const events = mergedEvents(await apiFetch("/api/events").catch(() => []));
  activityLog.innerHTML = "";
  if (!events.length) {
    activityLog.innerHTML = '<p class="muted">No activity yet.</p>';
    return;
  }
  events.forEach((event) => {
    const item = document.createElement("div");
    item.className = "activity-item";
    const canPush = event.type === "followup-manual";
    item.innerHTML = `
      <div class="activity-content">
        <strong>${event.type.toUpperCase()} - ${event.contactEmail || "No contact"}</strong>
        <span>${event.subject || event.campaignName || "Campaign activity"}</span>
        <span>${event.scheduledAt ? `Runs ${new Date(event.scheduledAt).toLocaleString()}` : new Date(event.createdAt).toLocaleString()}</span>
      </div>
      ${canPush ? `<button class="ghost-button compact" data-push="${event.id}" type="button">Push now</button>` : ""}
    `;
    activityLog.append(item);
  });
  document.querySelectorAll("[data-push]").forEach((button) => {
    button.addEventListener("click", async () => {
      await apiFetch(`/api/followups/${button.dataset.push}/push`, { method: "POST", body: JSON.stringify({}) });
      showToast("Follow-up pushed.");
      renderLaunchActivity();
    });
  });
}

document.querySelector("#runAutomationButton")?.addEventListener("click", async () => {
  const campaign = getJson(campaignKey);
  if (!campaign?.emails?.length) return showToast("Complete campaign setup first.");
  try {
    const result = await apiFetch("/api/automation/run", {
      method: "POST",
      body: JSON.stringify({
        campaign,
        segment: document.querySelector("#segmentSelect").value,
        limit: Number(document.querySelector("#sendLimitInput").value || 25),
      }),
    });
    mergeEvents((result.events || []).length ? result.events : fallbackEventsFromResults(result, campaign));
    showToast(result.partialFailure ? `${result.processed} sent, ${result.failures.length} failed.` : `${result.mode === "smtp" ? "Sent" : "Simulated"} ${result.processed} opener emails.`);
    renderLaunchActivity();
  } catch (error) {
    showToast(error.message);
  }
});
document.querySelector("#refreshActivityButton")?.addEventListener("click", renderLaunchActivity);
renderLaunchActivity();
