const toast = document.querySelector("#toast");
const campaignKey = "emailAutomationCampaign";
const setupKey = "emailAutomationSetup";
const sessionKey = "emailAutomationSession";
const localEventsKey = "emailAutomationEvents";
const localContactsKey = "emailAutomationContacts";
const mailboxKey = "emailAutomationMailbox";
const returnToKey = "emailAutomationReturnTo";
const orderedPages = ["setup.html", "mailbox.html", "audience.html", "campaign.html", "launch.html"];

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), Math.min(5200, Math.max(2400, String(message).length * 38)));
}

function setBusy(control, busy, label = "Working...") {
  if (!control) return;
  if (busy) {
    control.dataset.originalText = control.textContent;
    control.textContent = label;
    control.disabled = true;
    control.classList.add("is-busy");
  } else {
    control.textContent = control.dataset.originalText || control.textContent;
    control.disabled = false;
    control.classList.remove("is-busy");
    delete control.dataset.originalText;
  }
}

async function apiFetch(path, options = {}) {
  const { retryingAfterAuthClear = false, skipAuthRedirect = false, ...fetchOptions } = options || {};
  const session = getJson(sessionKey, {});
  const response = await fetch(path, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(fetchOptions.headers || {}),
    },
  });
  if (!response.ok) {
    if (response.status === 401 && session?.token && !retryingAfterAuthClear) {
      localStorage.removeItem(sessionKey);
      return apiFetch(path, { ...fetchOptions, skipAuthRedirect, retryingAfterAuthClear: true });
    }
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
        ? "Server error. Please try again, or check the mailbox connection."
        : `Request failed (${response.status}).`;
    if (response.status === 401 && !skipAuthRedirect && currentPage() !== "login.html") {
      localStorage.removeItem(sessionKey);
      localStorage.setItem(returnToKey, `${currentPage()}${window.location.search || ""}`);
      window.location.href = "login.html";
    }
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

async function hydrateSessionFromCookie() {
  try {
    const result = await apiFetch("/api/auth/session", { skipAuthRedirect: true });
    if (result?.token) {
      setJson(sessionKey, { ...result.session, token: result.token });
      return getJson(sessionKey);
    }
  } catch {
    localStorage.removeItem(sessionKey);
    return null;
  }
  return null;
}

function broadcastDashboardUpdate() {
  localStorage.setItem("emailAutomationLastUpdate", new Date().toISOString());
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
  broadcastDashboardUpdate();
}

function mergedEvents(apiEvents = []) {
  const byId = new Map();
  [...apiEvents, ...getJson(localEventsKey, [])].filter((event) => event?.id).forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((a, b) => new Date(b.createdAt || b.scheduledAt || 0) - new Date(a.createdAt || a.scheduledAt || 0));
}

function updateStoredEvent(eventId, patch = {}) {
  const events = getJson(localEventsKey, []);
  setJson(
    localEventsKey,
    events.map((event) => (event.id === eventId ? { ...event, ...patch } : event)),
  );
  broadcastDashboardUpdate();
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

async function getContacts() {
  const apiContacts = await apiFetch("/api/contacts").catch(() => []);
  const localContacts = getJson(localContactsKey, []);
  const byEmail = new Map();
  [...apiContacts, ...localContacts].forEach((contact) => {
    const email = String(contact.email || "").toLowerCase();
    if (email) byEmail.set(email, contact);
  });
  return [...byEmail.values()];
}

function fallbackEventsFromContacts(contacts, campaign, mode = "smtp") {
  const subject = campaign?.emails?.[0]?.subject || "Campaign activity";
  return contacts.map((contact, index) => ({
    id: `local_${mode === "smtp" ? "sent" : "simulation"}_${Date.now()}_${index}_${String(contact.email || "").replace(/[^a-z0-9]/gi, "_")}`,
    type: mode === "smtp" ? "sent" : "simulation",
    contactEmail: contact.email,
    campaignName: campaign?.offer || "Campaign",
    subject: subject
      .replaceAll("{{company}}", contact.company || "your team")
      .replaceAll("{{industry}}", contact.industry || "your industry"),
    createdAt: new Date().toISOString(),
  }));
}

function rememberSendMode(result = {}) {
  if (result.mode === "smtp" && Number(result.processed || 0) > 0) {
    const mailbox = getJson(mailboxKey, {});
    setJson(mailboxKey, { ...mailbox, connected: true, connectedAt: mailbox.connectedAt || new Date().toISOString() });
  }
}

function savedMailboxPayload() {
  const mailbox = getJson(mailboxKey, {});
  if (!mailbox.connected || !mailbox.smtpHost || !mailbox.smtpUser || !mailbox.smtpPass) return null;
  return mailbox;
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
  const mailbox = getJson(mailboxKey, {});
  const localContacts = getJson(localContactsKey, []);
  return {
    loggedIn: Boolean(getJson(sessionKey)?.token),
    setup: Boolean(setup.offer && setup.audience && setup.proof),
    mailbox: Boolean(status.mailConfigured || mailbox.connected),
    audience: Number(status.contactCount || 0) > 0 || localContacts.length > 0,
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

  await hydrateSessionFromCookie();
  const progress = await getProgress();
  if (!progress.loggedIn) {
    localStorage.setItem(returnToKey, `${page}${window.location.search || ""}`);
    window.location.href = "login.html";
    return;
  }

  const requiredByPage = {
    "mailbox.html": true,
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
    if (card.dataset.bound === "true") return;
    card.dataset.bound = "true";
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

function validateContacts(contacts) {
  if (!contacts.length) throw new Error("Add at least one contact row before importing.");
  const valid = contacts.filter((contact) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contact.email || "")));
  if (!valid.length) throw new Error("No valid email addresses found. Your first row must include an email column.");
  return valid;
}

function parseRecipients(value) {
  return [...new Set(String(value || "").split(/[\n,;]/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

document.querySelector("#loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  try {
    setBusy(button, true, "Signing in...");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.querySelector("#loginEmailInput").value.trim(),
        workspace: document.querySelector("#workspaceNameInput").value.trim(),
        password: document.querySelector("#loginPasswordInput").value,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Login failed.");
    setJson(sessionKey, { ...result.session, token: result.token });
    const returnTo = localStorage.getItem(returnToKey);
    localStorage.removeItem(returnToKey);
    window.location.href = returnTo && returnTo !== "login.html" ? returnTo : "index.html";
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
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
    const button = setupForm.querySelector("button[type='submit']");
    const nextSetup = {
      offer: document.querySelector("#offerInput").value.trim(),
      audience: document.querySelector("#audienceInput").value.trim(),
      goal: document.querySelector("#goalInput").value,
      voice: document.querySelector("#voiceInput").value,
      proof: document.querySelector("#proofInput").value.trim(),
      fromName: document.querySelector("#fromNameInput").value.trim(),
      replyTo: document.querySelector("#replyToInput").value.trim(),
    };
    if (!nextSetup.offer || !nextSetup.audience || !nextSetup.proof) return showToast("Complete the required setup fields first.");
    setBusy(button, true, "Saving setup...");
    setJson(setupKey, nextSetup);
    setJson(campaignKey, createCampaignFromSetup(nextSetup));
    window.location.href = "mailbox.html";
  });
}

const mailboxForm = document.querySelector("#mailboxForm");
if (mailboxForm) {
  const smtpPortInput = document.querySelector("#smtpPortInput");
  const smtpSecureInput = document.querySelector("#smtpSecureInput");
  const imapHostInput = document.querySelector("#imapHostInput");
  const imapPortInput = document.querySelector("#imapPortInput");
  const imapUserInput = document.querySelector("#imapUserInput");
  const imapPasswordInput = document.querySelector("#imapPasswordInput");
  const imapSecureInput = document.querySelector("#imapSecureInput");
  const connectMicrosoftButton = document.querySelector("#connectMicrosoftButton");
  const disconnectMicrosoftButton = document.querySelector("#disconnectMicrosoftButton");
  const graphConnectionStatus = document.querySelector("#graphConnectionStatus");
  const savedMailbox = getJson(mailboxKey, {});
  const mailConnectionStatus = document.querySelector("#mailConnectionStatus");
  const graphParams = new URLSearchParams(window.location.search);
  if (graphParams.get("graph") === "connected") {
    showToast(`Microsoft mailbox connected: ${graphParams.get("email") || "ready"}.`);
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (graphParams.get("graph") === "error") {
    showToast(graphParams.get("message") || "Microsoft connection failed.");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const renderGraphStatus = (mailbox = {}) => {
    if (!graphConnectionStatus) return;
    if (!mailbox.graphConfigured) {
      graphConnectionStatus.textContent = "Microsoft Graph is not configured on the server yet. Add the Azure app credentials in Vercel environment variables.";
      if (disconnectMicrosoftButton) disconnectMicrosoftButton.hidden = true;
      return;
    }
    if (mailbox.graphConnected) {
      graphConnectionStatus.textContent = `Microsoft Graph is connected as ${mailbox.graphEmail || mailbox.fromEmail || "this mailbox"}. Sending and inbox sync will use Graph.`;
      if (disconnectMicrosoftButton) disconnectMicrosoftButton.hidden = false;
      return;
    }
    graphConnectionStatus.textContent = "Microsoft Graph is configured but not connected yet.";
    if (disconnectMicrosoftButton) disconnectMicrosoftButton.hidden = true;
  };

  if (savedMailbox.connected && mailConnectionStatus) {
    mailConnectionStatus.textContent = `Mailbox is saved in this browser as ${savedMailbox.smtpUser || savedMailbox.fromEmail}.`;
  }
  const syncSecureWithPort = () => {
    const port = Number(smtpPortInput.value);
    if (port === 587) smtpSecureInput.checked = false;
    if (port === 465) smtpSecureInput.checked = true;
  };
  const inferImapHost = (smtpHost = "") => {
    const host = smtpHost.toLowerCase();
    if (host.includes("office365") || host.includes("outlook")) return "outlook.office365.com";
    if (host.includes("gmail")) return "imap.gmail.com";
    return "";
  };
  const applyMailboxValues = (mailbox = {}) => {
    document.querySelector("#smtpHostInput").value = mailbox.smtpHost || "";
    smtpPortInput.value = mailbox.smtpPort || 587;
    document.querySelector("#smtpUserInput").value = mailbox.smtpUser || "";
    document.querySelector("#smtpPasswordInput").value = savedMailbox.smtpPass || "";
    document.querySelector("#fromNameInput").value = mailbox.fromName || "";
    document.querySelector("#fromEmailInput").value = mailbox.fromEmail || "";
    document.querySelector("#replyToInput").value = mailbox.replyTo || "";
    document.querySelector("#companyAddressInput").value = mailbox.address || "";
    smtpSecureInput.checked = Boolean(mailbox.smtpSecure);
    imapHostInput.value = mailbox.imapHost || inferImapHost(mailbox.smtpHost || "");
    imapPortInput.value = mailbox.imapPort || 993;
    imapUserInput.value = mailbox.imapUser || mailbox.smtpUser || "";
    imapPasswordInput.value = savedMailbox.imapPass || "";
    imapSecureInput.checked = mailbox.imapSecure !== false;
    renderGraphStatus(mailbox);
    syncSecureWithPort();
  };

  apiFetch("/api/mail/config").then((config) => {
    const mergedConfig = { ...savedMailbox, ...Object.fromEntries(Object.entries(config).filter(([, value]) => value !== "" && value !== undefined && value !== null)) };
    applyMailboxValues(mergedConfig);
  }).catch(() => {
    applyMailboxValues(savedMailbox);
  });

  smtpPortInput.addEventListener("input", syncSecureWithPort);
  document.querySelector("#smtpHostInput").addEventListener("blur", () => {
    if (!imapHostInput.value.trim()) imapHostInput.value = inferImapHost(document.querySelector("#smtpHostInput").value);
  });

  mailboxForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = mailboxForm.querySelector("button[type='submit']");
    try {
      setBusy(button, true, "Verifying mailbox...");
      syncSecureWithPort();
      const nextMailbox = {
        smtpHost: document.querySelector("#smtpHostInput").value.trim(),
        smtpPort: smtpPortInput.value,
        smtpUser: document.querySelector("#smtpUserInput").value.trim(),
        smtpSecure: smtpSecureInput.checked,
        fromName: document.querySelector("#fromNameInput").value.trim(),
        fromEmail: document.querySelector("#fromEmailInput").value.trim(),
        replyTo: document.querySelector("#replyToInput").value.trim(),
        address: document.querySelector("#companyAddressInput").value.trim(),
        smtpPass: document.querySelector("#smtpPasswordInput").value,
        imapHost: imapHostInput.value.trim(),
        imapPort: imapPortInput.value || 993,
        imapSecure: imapSecureInput.checked,
        imapUser: imapUserInput.value.trim() || document.querySelector("#smtpUserInput").value.trim(),
        imapPass: imapPasswordInput.value || document.querySelector("#smtpPasswordInput").value,
      };
      await apiFetch("/api/mail/connect", {
        method: "POST",
        body: JSON.stringify(nextMailbox),
      });
      setJson(mailboxKey, { ...nextMailbox, connected: true, connectedAt: new Date().toISOString() });
      if (mailConnectionStatus) mailConnectionStatus.textContent = `Mailbox is saved in this browser as ${nextMailbox.smtpUser}.`;
      showToast("Mailbox verified and saved.");
      window.setTimeout(() => (window.location.href = "audience.html"), 700);
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy(button, false);
    }
  });

  connectMicrosoftButton?.addEventListener("click", async () => {
    try {
      setBusy(connectMicrosoftButton, true, "Opening Microsoft...");
      const result = await apiFetch("/api/microsoft/auth-url");
      window.location.href = result.url;
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy(connectMicrosoftButton, false);
    }
  });

  disconnectMicrosoftButton?.addEventListener("click", async () => {
    try {
      setBusy(disconnectMicrosoftButton, true, "Disconnecting...");
      const result = await apiFetch("/api/microsoft/disconnect", { method: "POST", body: JSON.stringify({}) });
      renderGraphStatus(result);
      showToast("Microsoft Graph disconnected.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy(disconnectMicrosoftButton, false);
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
  const button = document.querySelector("#importContactsButton");
  try {
    setBusy(button, true, "Importing...");
    const contacts = validateContacts(parseCsv(document.querySelector("#contactsInput").value));
    const result = await apiFetch("/api/contacts/import", { method: "POST", body: JSON.stringify({ contacts }) });
    setJson(localContactsKey, result.contacts || contacts);
    broadcastDashboardUpdate();
    document.querySelector("#contactImportStatus").textContent = `${result.activeContacts} active contacts imported`;
    showToast("Contacts imported and segmented.");
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
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

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-subject], [data-body], #followupOneMode, #followupOneDays, #followupTwoMode, #followupTwoDays")) {
    window.clearTimeout(saveCampaignEditor.timeout);
    saveCampaignEditor.timeout = window.setTimeout(() => {
      saveCampaignEditor();
    }, 350);
  }
});

renderCampaignEditor();
document.querySelector("#regenerateCampaignButton")?.addEventListener("click", () => {
  const setup = getJson(setupKey);
  if (!setup?.offer) return showToast("Complete setup first.");
  setJson(campaignKey, createCampaignFromSetup(setup));
  renderCampaignEditor();
  showToast("Campaign regenerated.");
});
document.querySelector("#sendTestButton")?.addEventListener("click", async () => {
  const button = document.querySelector("#sendTestButton");
  const campaign = saveCampaignEditor();
  const recipients = parseRecipients(document.querySelector("#testRecipientsInput").value);
  if (!campaign) return showToast("Complete setup first.");
  if (!recipients.length) return showToast("Add at least one test recipient.");
  try {
    setBusy(button, true, "Sending test...");
    const result = await apiFetch("/api/test/send", { method: "POST", body: JSON.stringify({ campaign, recipients, mailbox: savedMailboxPayload() }) });
    rememberSendMode(result);
    mergeEvents((result.events || []).length ? result.events : fallbackEventsFromResults(result, campaign, "test-"));
    showToast(result.partialFailure ? `${result.processed} sent, ${result.failures.length} failed.` : `${result.mode === "smtp" ? "Sent" : "Simulated"} ${result.processed} test emails.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
});

async function renderLaunchActivity() {
  const activityLog = document.querySelector("#activityLog");
  if (!activityLog) return;
  const providerMode = document.querySelector("#providerMode");
  if (providerMode) {
    const status = await apiFetch("/api/status").catch(() => ({}));
    const mailbox = getJson(mailboxKey, {});
    const connected = Boolean(status.mailConfigured || mailbox.connected);
    providerMode.textContent = status.providerMode === "graph" ? "Microsoft Graph mode" : connected ? "SMTP mode" : "Simulation mode";
    providerMode.classList.toggle("success", connected);
  }
  const events = mergedEvents(await apiFetch("/api/events").catch(() => []));
  activityLog.innerHTML = "";
  if (!events.length) {
    activityLog.innerHTML = '<div class="empty-state"><strong>No activity yet</strong><span>Run the opener or send a selected test to see activity here immediately.</span></div>';
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
      const event = mergedEvents().find((item) => item.id === button.dataset.push);
      const result = await apiFetch(`/api/followups/${button.dataset.push}/push`, { method: "POST", body: JSON.stringify({ mailbox: savedMailboxPayload(), event }) });
      updateStoredEvent(button.dataset.push, { type: result.event?.type || "followup-sent", pushedAt: new Date().toISOString(), subject: result.event?.subject || event?.subject });
      if (result.event) mergeEvents([result.event]);
      showToast("Follow-up pushed.");
      renderLaunchActivity();
    });
  });
}

document.querySelector("#processFollowupsButton")?.addEventListener("click", async () => {
  const button = document.querySelector("#processFollowupsButton");
  const due = mergedEvents().filter((event) => event.type === "followup-scheduled" && event.scheduledAt && new Date(event.scheduledAt) <= new Date());
  if (!due.length) return showToast("No due follow-ups right now.");

  setBusy(button, true, "Running...");
  let processed = 0;
  let failed = 0;
  try {
    for (const event of due.slice(0, 25)) {
      try {
        const result = await apiFetch(`/api/followups/${event.id}/push`, { method: "POST", body: JSON.stringify({ mailbox: savedMailboxPayload(), event }) });
        updateStoredEvent(event.id, { type: result.event?.type || "followup-sent", pushedAt: new Date().toISOString(), subject: result.event?.subject || event.subject });
        if (result.event) mergeEvents([result.event]);
        processed += 1;
      } catch {
        failed += 1;
      }
    }
    showToast(failed ? `${processed} follow-ups sent, ${failed} failed.` : `${processed} due follow-ups sent.`);
    renderLaunchActivity();
  } finally {
    setBusy(button, false);
  }
});

document.querySelector("#runAutomationButton")?.addEventListener("click", async () => {
  const button = document.querySelector("#runAutomationButton");
  const campaign = getJson(campaignKey);
  if (!campaign?.emails?.length) return showToast("Complete campaign setup first.");
  try {
    setBusy(button, true, "Sending opener...");
    const contacts = await getContacts();
    const limit = Number(document.querySelector("#sendLimitInput").value || 25);
    const selectedContacts = contacts.slice(0, limit);
    if (!selectedContacts.length) throw new Error("Import contacts before launching the opener.");
    const result = await apiFetch("/api/automation/run", {
      method: "POST",
      body: JSON.stringify({
        campaign,
        mailbox: savedMailboxPayload(),
        segment: document.querySelector("#segmentSelect").value,
        limit,
      }),
    });
    rememberSendMode(result);
    const resultFallbackEvents = fallbackEventsFromResults(result, campaign);
    const fallbackEvents = resultFallbackEvents.length
      ? resultFallbackEvents
      : fallbackEventsFromContacts(selectedContacts.slice(0, Number(result.processed || 0)), campaign, result.mode);
    mergeEvents((result.events || []).length ? result.events : fallbackEvents);
    showToast(result.partialFailure ? `${result.processed} sent, ${result.failures.length} failed.` : `${result.mode === "smtp" ? "Sent" : "Simulated"} ${result.processed} opener emails.`);
    renderLaunchActivity();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
});
document.querySelector("#refreshActivityButton")?.addEventListener("click", renderLaunchActivity);
renderLaunchActivity();
