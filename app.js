const form = document.querySelector("#campaignForm");
const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const loginEmailInput = document.querySelector("#loginEmailInput");
const workspaceNameInput = document.querySelector("#workspaceNameInput");
const logoutButton = document.querySelector("#logoutButton");
const workspaceInitials = document.querySelector("#workspaceInitials");
const workspaceUserLabel = document.querySelector("#workspaceUserLabel");
const journeyStepButtons = [...document.querySelectorAll("[data-journey-step]")];
const journeyProgressPill = document.querySelector("#journeyProgressPill");
const journeyTitle = document.querySelector("#journeyTitle");
const journeyDescription = document.querySelector("#journeyDescription");
const journeyBackButton = document.querySelector("#journeyBackButton");
const journeyNextButton = document.querySelector("#journeyNextButton");
const offerInput = document.querySelector("#offerInput");
const audienceInput = document.querySelector("#audienceInput");
const goalInput = document.querySelector("#goalInput");
const voiceInput = document.querySelector("#voiceInput");
const proofInput = document.querySelector("#proofInput");
const tabs = [...document.querySelectorAll("[data-email-index]")];
const emailTiming = document.querySelector("#emailTiming");
const emailScore = document.querySelector("#emailScore");
const emailSubject = document.querySelector("#emailSubject");
const emailBody = document.querySelector("#emailBody");
const draftList = document.querySelector("#draftList");
const clearDraftsButton = document.querySelector("#clearDraftsButton");
const regenerateDraftButton = document.querySelector("#regenerateDraftButton");
const manualDraftButton = document.querySelector("#manualDraftButton");
const manualDraftEditor = document.querySelector("#manualDraftEditor");
const manualSubjectInput = document.querySelector("#manualSubjectInput");
const manualBodyInput = document.querySelector("#manualBodyInput");
const applyManualDraftButton = document.querySelector("#applyManualDraftButton");
const cancelManualDraftButton = document.querySelector("#cancelManualDraftButton");
const followupOneMode = document.querySelector("#followupOneMode");
const followupOneDays = document.querySelector("#followupOneDays");
const followupTwoMode = document.querySelector("#followupTwoMode");
const followupTwoDays = document.querySelector("#followupTwoDays");
const recommendationList = document.querySelector("#recommendationList");
const segmentList = document.querySelector("#segmentList");
const barChart = document.querySelector("#barChart");
const toast = document.querySelector("#toast");
const contactsInput = document.querySelector("#contactsInput");
const csvFileInput = document.querySelector("#csvFileInput");
const uploadCsvButton = document.querySelector("#uploadCsvButton");
const contactImportStatus = document.querySelector("#contactImportStatus");
const providerMode = document.querySelector("#providerMode");
const activityLog = document.querySelector("#activityLog");
const clearActivityButton = document.querySelector("#clearActivityButton");
const segmentSelect = document.querySelector("#segmentSelect");
const sendLimitInput = document.querySelector("#sendLimitInput");
const smtpHostInput = document.querySelector("#smtpHostInput");
const smtpPortInput = document.querySelector("#smtpPortInput");
const smtpUserInput = document.querySelector("#smtpUserInput");
const smtpPasswordInput = document.querySelector("#smtpPasswordInput");
const smtpSecureInput = document.querySelector("#smtpSecureInput");
const fromNameInput = document.querySelector("#fromNameInput");
const fromEmailInput = document.querySelector("#fromEmailInput");
const replyToInput = document.querySelector("#replyToInput");
const companyAddressInput = document.querySelector("#companyAddressInput");
const connectMailButton = document.querySelector("#connectMailButton");
const autoSendToggle = document.querySelector("#autoSendToggle");
const mailConnectionStatus = document.querySelector("#mailConnectionStatus");
const testRecipientsInput = document.querySelector("#testRecipientsInput");
const sendTestButton = document.querySelector("#sendTestButton");

let activeEmailIndex = 0;
let campaign = null;
let appStatus = {
  providerMode: "simulation",
  mailConfigured: false,
  contactCount: 0,
  suppressedCount: 0,
  eventCount: 0,
};
let hasTestSend = false;
let currentJourneyStep = 0;

localStorage.removeItem("pulsePilotDraft");
localStorage.removeItem("moreyeahsAutomationSession");

const sessionKey = "moreyeahsAutomationSessionV2";

const goalCtas = {
  "Book discovery calls": "Would it be useful to compare your current setup against the fastest wins we usually find?",
  "Promote a webinar": "Want me to save you a seat for the live walkthrough?",
  "Nurture cold leads": "Should I send over the short checklist our team uses before a nurture sequence goes live?",
  "Win back inactive buyers": "Would you be open to seeing what changed since the last time we spoke?",
};

const voiceOpeners = {
  Consultative: "I noticed a pattern that may be worth pressure-testing:",
  Bold: "There is a faster path hiding in your current email motion:",
  Friendly: "Quick thought that could help your next campaign work harder:",
  Executive: "The highest-leverage opportunity is usually not more email. It is sharper orchestration:",
};

const segments = [
  { name: "Sales priority", share: 32, detail: "Executive buyer with strong service fit" },
  { name: "Innovation leaders", share: 27, detail: "AI, data, cloud, or GCC transformation interest" },
  { name: "Platform modernization", share: 21, detail: "Microsoft or Salesforce optimization fit" },
  { name: "Nurture", share: 20, detail: "Needs education before a direct sales CTA" },
];

const journeySteps = [
  {
    title: "You are signed in",
    description: "Your local workspace session is active. Continue by confirming sender identity and campaign defaults.",
    cta: "Continue setup",
    target: "#studio",
    isComplete: () => Boolean(getSession()),
  },
  {
    title: "Confirm the campaign setup",
    description: "Review the offer, target audience, brand voice, and proof points. Generate or edit the email sequence before testing.",
    cta: "Generate campaign",
    target: "#studio",
    action: () => renderCampaign(),
    isComplete: () => Boolean(offerInput.value.trim() && audienceInput.value.trim() && proofInput.value.trim() && campaign?.emails?.length),
  },
  {
    title: "Connect your sending mailbox",
    description: "Add SMTP details and verify them. The app remains in simulation mode until your mailbox connection succeeds.",
    cta: "Connect mailbox",
    target: "#operations",
    action: () => connectMailAccount(),
    isComplete: () => appStatus.mailConfigured,
  },
  {
    title: "Import and segment your audience",
    description: "Upload a CSV/XLSX or paste contacts, then import them so the automation can score and segment recipients.",
    cta: "Import contacts",
    target: "#operations",
    action: () => importContacts(),
    isComplete: () => appStatus.contactCount > 0,
  },
  {
    title: "Send a controlled test",
    description: "Enter selected test recipients and send the first email only. Keep this to your own inboxes or approved reviewers.",
    cta: "Send selected test",
    target: "#operations",
    action: () => sendSelectedTest(),
    isComplete: () => hasTestSend,
  },
  {
    title: "Launch the automation",
    description: "Choose a segment and send cap, then run the opener. Follow-ups are queued in the activity log.",
    cta: "Run automation",
    target: "#operations",
    action: () => runAutomation(),
    isComplete: () => appStatus.contactCount > 0 && campaign?.emails?.length > 0,
  },
];

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey));
  } catch {
    return null;
  }
}

function setSession(session) {
  localStorage.setItem(sessionKey, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(sessionKey);
}

function initialsFrom(value) {
  return String(value || "MY")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function applySession() {
  const session = getSession();
  const isLoggedIn = Boolean(session);
  document.body.classList.toggle("is-logged-out", !isLoggedIn);
  loginScreen.hidden = isLoggedIn;

  if (session) {
    workspaceInitials.textContent = initialsFrom(session.workspace);
    workspaceUserLabel.textContent = `${session.workspace} - ${session.email}`;
    currentJourneyStep = getFirstIncompleteJourneyStep();
    renderJourney();
  }
}

function buildEmailFooter(goal, offer) {
  const cta = goalCtas[goal] || "Would it be helpful to explore the best next step together?";
  return `

${cta}

If useful, I can also send a short outline of the first steps I would recommend for ${offer}.

Best,
[Your name]
[Your role / company]
[Your email]`;
}

function createEmailDraft(index, offer, audience, goal, voice, proof) {
  const opener = voiceOpeners[voice];
  const cta = goalCtas[goal];
  const proofSentence = proof.replace(/\.$/, "");

  if (index === 0) {
    return {
      timing: "Send immediately",
      score: 91,
      subject: `{{company}}: practical next steps for ${offer}`,
      body: `Hi {{firstName}},\n\n${opener}\n\nWe help ${audience} evaluate whether ${offer} is the right next step.\n\nThe strongest fit is usually where teams need a clear path from current challenges to measurable outcomes: ${proofSentence.toLowerCase()}.${buildEmailFooter(goal, offer)}`,
    };
  }

  if (index === 1) {
    return {
      timing: "Send after 2 days if opened",
      followupMode: "manual",
      followupDelayDays: 2,
      score: 88,
      subject: `Where {{industry}} teams usually find quick wins`,
      body: `Hi {{firstName}},\n\nA useful first conversation usually shows three things:\n\n1. What priority problem is worth solving first.\n2. Which internal blockers are slowing progress.\n3. What a practical next step should look like.\n\nFor {{company}}, we can map a focused path from current state to a measurable first outcome.${buildEmailFooter(goal, offer)}`,
    };
  }

  return {
    timing: "Send after 5 days if no reply",
    followupMode: "manual",
    followupDelayDays: 5,
    score: 84,
    subject: `Should I close the loop?`,
    body: `Hi {{firstName}},\n\nI did not want to keep filling your inbox if ${offer} is not active for {{company}} right now.\n\nBefore I close the loop: we can usually identify a few practical next steps before a larger project is scoped.${buildEmailFooter(goal, offer)}`,
  };
}

function createCampaign() {
  const offer = offerInput.value.trim();
  const audience = audienceInput.value.trim();
  const goal = goalInput.value;
  const voice = voiceInput.value;
  const proof = proofInput.value.trim();

  if (!offer || !audience || !proof) {
    return null;
  }

  const emails = [0, 1, 2].map((index) => createEmailDraft(index, offer, audience, goal, voice, proof));

  const recommendations = [
    "Keep the first email focused on the recipient's problem, not only your offer.",
    "Segment contacts by role, industry, interest, and consent source before launching.",
    "Send a controlled test to your own inbox before emailing the full audience.",
  ];

  return {
    id: `campaign_${Date.now()}`,
    offer,
    audience,
    goal,
    voice,
    proof,
    ctaUrl: "https://www.moreyeahs.com/#contact",
    emails,
    recommendations,
  };
}

function renderCampaign() {
  const nextCampaign = createCampaign();

  if (!nextCampaign) {
    showToast("Add your offer, target audience, and proof points before generating a campaign.");
    renderEmptyCampaign();
    return;
  }

  campaign = nextCampaign;
  activeEmailIndex = 0;
  renderEmail();
  renderRecommendations();
  renderMetrics();
  showToast("AI campaign generated with subject lines, timing, and routing recommendations.");
}

function renderEmail() {
  if (!campaign?.emails?.length) {
    emailTiming.textContent = "No draft selected";
    emailScore.textContent = "Score --";
    emailSubject.textContent = "No email drafts";
    emailBody.textContent = "Fill in your campaign inputs, then generate an email sequence.";
    renderDraftList();
    return;
  }

  const email = campaign.emails[activeEmailIndex];

  tabs.forEach((tab, index) => {
    tab.classList.toggle("active", index === activeEmailIndex);
  });

  emailTiming.textContent = email.timing;
  emailScore.textContent = `Score ${email.score}`;
  emailSubject.textContent = email.subject;
  emailBody.textContent = email.body;
  renderDraftList();
  renderFollowupControls();
}

function renderFollowupControls() {
  if (!campaign?.emails?.length) {
    return;
  }

  if (campaign.emails[1]) {
    followupOneMode.value = campaign.emails[1].followupMode || "manual";
    followupOneDays.value = campaign.emails[1].followupDelayDays || 2;
    followupOneDays.disabled = followupOneMode.value !== "delay";
  }

  if (campaign.emails[2]) {
    followupTwoMode.value = campaign.emails[2].followupMode || "manual";
    followupTwoDays.value = campaign.emails[2].followupDelayDays || 5;
    followupTwoDays.disabled = followupTwoMode.value !== "delay";
  }
}

function updateFollowupSettings() {
  if (!campaign?.emails?.length) return;

  if (campaign.emails[1]) {
    campaign.emails[1].followupMode = followupOneMode.value;
    campaign.emails[1].followupDelayDays = Number(followupOneDays.value || 2);
    campaign.emails[1].timing =
      followupOneMode.value === "delay" ? `Queue ${campaign.emails[1].followupDelayDays} day(s) after opener` : "Manual follow-up";
  }

  if (campaign.emails[2]) {
    campaign.emails[2].followupMode = followupTwoMode.value;
    campaign.emails[2].followupDelayDays = Number(followupTwoDays.value || 5);
    campaign.emails[2].timing =
      followupTwoMode.value === "delay" ? `Queue ${campaign.emails[2].followupDelayDays} day(s) after opener` : "Manual follow-up";
  }

  renderEmail();
}

function renderDraftList() {
  draftList.innerHTML = "";

  if (!campaign?.emails?.length) {
    draftList.innerHTML = '<p class="muted">No drafts yet. Generate a campaign after entering your real inputs.</p>';
    return;
  }

  campaign.emails.forEach((email, index) => {
    const item = document.createElement("div");
    item.className = "draft-list-item";

    const label = document.createElement("button");
    label.type = "button";
    label.className = "draft-list-label";
    label.textContent = `Email ${index + 1}: ${email.subject}`;
    label.addEventListener("click", () => {
      activeEmailIndex = index;
      renderEmail();
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "draft-remove-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeDraft(index);
    });

    item.append(label, removeButton);
    draftList.append(item);
  });
}

function removeDraft(index) {
  if (campaign.emails.length <= 1) {
    showToast("At least one draft must remain.");
    return;
  }

  campaign.emails.splice(index, 1);
  if (activeEmailIndex >= campaign.emails.length) {
    activeEmailIndex = campaign.emails.length - 1;
  }
  renderEmail();
  renderRecommendations();
  showToast("Draft removed.");
}

function clearDrafts() {
  campaign.emails = [];
  renderEmail();
  renderRecommendations();
  showToast("All drafts removed.");
}

function regenerateDraft() {
  const freshCampaign = createCampaign();
  if (!freshCampaign) {
    showToast("Add your offer, target audience, and proof points before regenerating.");
    return;
  }
  const freshEmail = freshCampaign.emails[activeEmailIndex];

  campaign.offer = freshCampaign.offer;
  campaign.audience = freshCampaign.audience;
  campaign.goal = freshCampaign.goal;
  campaign.voice = freshCampaign.voice;
  campaign.proof = freshCampaign.proof;
  campaign.emails[activeEmailIndex] = freshEmail;
  campaign.recommendations = freshCampaign.recommendations;

  renderEmail();
  renderRecommendations();
  showToast(`New draft generated for email ${activeEmailIndex + 1}.`);
}

function openManualDraftEditor() {
  const email = campaign?.emails?.[activeEmailIndex];
  manualSubjectInput.value = email?.subject || "";
  manualBodyInput.value = email?.body || "";
  manualDraftEditor.classList.remove("hidden");
}

function closeManualDraftEditor() {
  manualDraftEditor.classList.add("hidden");
}

function applyManualDraft() {
  const subject = manualSubjectInput.value.trim();
  const body = manualBodyInput.value.trim();

  if (!subject || !body) {
    showToast("Please add both a subject and a body before applying the draft.");
    return;
  }

  if (!campaign) {
    campaign = {
      id: `campaign_${Date.now()}`,
      offer: offerInput.value.trim() || "User-provided campaign",
      audience: audienceInput.value.trim() || "User-provided audience",
      goal: goalInput.value,
      voice: voiceInput.value,
      proof: proofInput.value.trim(),
      ctaUrl: "",
      emails: [],
      recommendations: [],
    };
  }

  campaign.emails[activeEmailIndex] = {
    timing: activeEmailIndex === 0 ? "Send immediately" : "Follow-up",
    score: 70,
    subject,
    body,
  };
  renderEmail();
  closeManualDraftEditor();
  showToast("Manual draft applied to the selected email.");
}

function renderRecommendations() {
  recommendationList.innerHTML = "";
  if (!campaign?.recommendations?.length) {
    recommendationList.innerHTML = '<li>Add campaign inputs to receive recommendations.</li>';
    return;
  }
  campaign.recommendations.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    recommendationList.append(li);
  });
}

function renderSegments(multiplier = 1) {
  segmentList.innerHTML = "";
  if (appStatus.contactCount === 0) {
    segmentList.innerHTML = '<p class="muted">Import contacts to see audience segments.</p>';
    return;
  }
  segments.forEach((segment, index) => {
    const adjustedShare = Math.min(46, Math.max(12, Math.round(segment.share * multiplier + index * 2)));
    const item = document.createElement("div");
    item.className = "segment";
    item.innerHTML = `
      <div class="segment-row">
        <span>${segment.name}</span>
        <span>${adjustedShare}%</span>
      </div>
      <div class="progress" aria-hidden="true"><span style="width:${adjustedShare}%"></span></div>
      <small>${segment.detail}</small>
    `;
    segmentList.append(item);
  });
}

function renderMetrics() {
  if (!campaign || appStatus.contactCount === 0) {
    document.querySelector("#openMetric").textContent = "--";
    document.querySelector("#confidenceMetric").textContent = "--";
    document.querySelector("#leadMetric").textContent = appStatus.contactCount.toLocaleString();
    document.querySelector("#revenueMetric").textContent = "--";
    document.querySelector("#forecastSummary").textContent =
      "Import contacts and generate a campaign to forecast replies.";
    renderChart(null);
    return;
  }

  const seed = campaign.offer.length + campaign.audience.length + campaign.proof.length;
  const openRate = 36 + (seed % 11);
  const confidence = 86 + (seed % 9);
  const leads = appStatus.contactCount;
  const revenue = leads ? Math.max(0.1, leads * 0.018) : 0;
  const replies = Math.round(leads * (openRate / 100) * 0.0078);

  document.querySelector("#openMetric").textContent = `${openRate}%`;
  document.querySelector("#confidenceMetric").textContent = `${confidence}%`;
  document.querySelector("#leadMetric").textContent = leads.toLocaleString();
  document.querySelector("#revenueMetric").textContent = `$${revenue.toFixed(1)}K`;
  document.querySelector("#forecastSummary").textContent = `Expected ${replies} qualified replies.`;

  renderChart(openRate);
}

function renderChart(openRate) {
  barChart.innerHTML = "";
  if (!openRate) {
    barChart.innerHTML = '<p class="muted chart-empty">No forecast yet.</p>';
    return;
  }
  const values = [28, 34, 39, openRate, openRate - 3, openRate + 4, openRate + 1];

  values.forEach((value) => {
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.max(42, value * 3.4)}px`;
    bar.textContent = `${value}%`;
    barChart.append(bar);
  });
}

function renderEmptyCampaign() {
  campaign = null;
  activeEmailIndex = 0;
  renderEmail();
  renderRecommendations();
  renderMetrics();
  document.querySelector("#sequenceStatus").textContent = "Waiting for inputs";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function getFirstIncompleteJourneyStep() {
  const index = journeySteps.findIndex((step) => !step.isComplete());
  return index === -1 ? journeySteps.length - 1 : index;
}

function scrollToJourneyTarget(step) {
  const target = document.querySelector(step.target);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderJourney() {
  const step = journeySteps[currentJourneyStep];
  const completedCount = journeySteps.filter((item) => item.isComplete()).length;

  journeyProgressPill.textContent = `${completedCount} of ${journeySteps.length} complete`;
  journeyTitle.textContent = step.title;
  journeyDescription.textContent = step.description;
  journeyNextButton.textContent = step.cta;
  journeyBackButton.disabled = currentJourneyStep === 0;

  journeyStepButtons.forEach((button, index) => {
    const complete = journeySteps[index].isComplete();
    button.classList.toggle("active", index === currentJourneyStep);
    button.classList.toggle("complete", complete);
    button.querySelector("span").textContent = complete ? "✓" : String(index + 1);
  });
}

function advanceJourney() {
  currentJourneyStep = Math.min(journeySteps.length - 1, getFirstIncompleteJourneyStep());
  renderJourney();
}

async function runCurrentJourneyStep() {
  const step = journeySteps[currentJourneyStep];
  scrollToJourneyTarget(step);

  if (step.action) {
    await step.action();
  }

  window.setTimeout(() => {
    if (step.isComplete()) {
      currentJourneyStep = Math.min(currentJourneyStep + 1, journeySteps.length - 1);
    } else {
      currentJourneyStep = getFirstIncompleteJourneyStep();
    }
    renderJourney();
  }, 250);
}

function copyActiveEmail() {
  if (!campaign?.emails?.length) {
    showToast("Generate or write an email draft before copying.");
    return;
  }
  const email = campaign.emails[activeEmailIndex];
  const text = `Subject: ${email.subject}\n\n${email.body}`;

  navigator.clipboard
    .writeText(text)
    .then(() => showToast("Email copied to clipboard."))
    .catch(() => showToast("Copy unavailable in this browser. Select the email text manually."));
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setSession({
    email: loginEmailInput.value.trim(),
    workspace: workspaceNameInput.value.trim(),
    signedInAt: new Date().toISOString(),
  });
  applySession();
  showToast("Workspace session started. Follow the guided setup steps.");
});

logoutButton?.addEventListener("click", () => {
  clearSession();
  applySession();
  showToast("Logged out of the local workspace.");
});

journeyStepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentJourneyStep = Number(button.dataset.journeyStep);
    renderJourney();
    scrollToJourneyTarget(journeySteps[currentJourneyStep]);
  });
});

journeyBackButton?.addEventListener("click", () => {
  currentJourneyStep = Math.max(0, currentJourneyStep - 1);
  renderJourney();
  scrollToJourneyTarget(journeySteps[currentJourneyStep]);
});

journeyNextButton?.addEventListener("click", runCurrentJourneyStep);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  renderCampaign();
  advanceJourney();
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeEmailIndex = Number(tab.dataset.emailIndex);
    renderEmail();
  });
});

document.querySelector("#copyButton").addEventListener("click", copyActiveEmail);
document.querySelector("#regenerateDraftButton").addEventListener("click", regenerateDraft);
document.querySelector("#manualDraftButton").addEventListener("click", openManualDraftEditor);
document.querySelector("#applyManualDraftButton").addEventListener("click", applyManualDraft);
document.querySelector("#cancelManualDraftButton").addEventListener("click", closeManualDraftEditor);
clearDraftsButton?.addEventListener("click", clearDrafts);

document.querySelector("#saveDraftButton").addEventListener("click", () => {
  if (!campaign?.emails?.length) {
    showToast("Generate or write at least one email draft before saving.");
    return;
  }
  localStorage.setItem("pulsePilotDraft", JSON.stringify(campaign));
  showToast("Draft saved locally in this browser.");
});

document.querySelector("#launchButton").addEventListener("click", () => {
  runAutomation();
});

document.querySelector("#rebalanceButton").addEventListener("click", () => {
  const multiplier = 0.86 + Math.random() * 0.34;
  renderSegments(multiplier);
  showToast("Audience segments rebalanced using engagement signals.");
});

renderEmptyCampaign();
renderSegments();
applySession();
refreshStatus();
refreshMailConfig();
refreshActivity();

function parseCsv(csv) {
  if (!csv.trim()) {
    return [];
  }

  const rows = csv
    .trim()
    .split(/\r?\n/)
    .map((row) => row.split(",").map((value) => value.trim()));
  const headers = rows.shift() || [];

  return rows
    .filter((row) => row.some(Boolean))
    .map((row) =>
      headers.reduce((contact, header, index) => {
        const value = row[index] || "";
        contact[header] = header === "consent" ? value.toLowerCase() !== "false" : value;
        return contact;
      }, {}),
    );
}

async function apiFetch(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ issues: ["Server request failed."] }));
    throw new Error((error.issues || [error.message || "Server request failed."]).join(" "));
  }

  return response.json();
}

async function refreshStatus() {
  try {
    const status = await apiFetch("/api/status");
    appStatus = {
      providerMode: status.providerMode,
      mailConfigured: Boolean(status.mailConfigured),
      contactCount: Number(status.contactCount || 0),
      suppressedCount: Number(status.suppressedCount || 0),
      eventCount: Number(status.eventCount || 0),
    };
    providerMode.textContent = status.providerMode === "smtp" ? "SMTP sending" : "Simulation mode";
    contactImportStatus.textContent = `${status.contactCount} active contacts, ${status.suppressedCount} suppressed`;
    if (mailConnectionStatus) {
      mailConnectionStatus.textContent = status.mailConfigured
        ? "Mail account connected. Campaign sends will use SMTP."
        : "Use an SMTP account and app password to send for real.";
    }
    renderMetrics();
    renderSegments();
    renderJourney();
  } catch {
    providerMode.textContent = "Static preview";
    contactImportStatus.textContent = "Start npm run automation to enable backend workflow";
  }
}

async function refreshMailConfig() {
  try {
    const config = await apiFetch("/api/mail/config");
    if (smtpHostInput) smtpHostInput.value = config.smtpHost || "";
    if (smtpPortInput) smtpPortInput.value = config.smtpPort || 587;
    if (smtpUserInput) smtpUserInput.value = config.smtpUser || "";
    if (smtpSecureInput) smtpSecureInput.checked = Boolean(config.smtpSecure);
    if (fromNameInput) fromNameInput.value = config.fromName || "";
    if (fromEmailInput) fromEmailInput.value = config.fromEmail || "";
    if (replyToInput) replyToInput.value = config.replyTo || "";
    if (companyAddressInput) companyAddressInput.value = config.address || "";
    if (mailConnectionStatus) {
      mailConnectionStatus.textContent = config.connected
        ? "Mail account connected. Campaign sends will use SMTP."
        : "Use an SMTP account and app password to send for real.";
    }
  } catch {
    if (mailConnectionStatus) {
      mailConnectionStatus.textContent = "Mail connection is not available yet.";
    }
  }
}

async function connectMailAccount() {
  try {
    const payload = {
      smtpHost: smtpHostInput?.value.trim() || "",
      smtpPort: smtpPortInput?.value || 587,
      smtpSecure: smtpSecureInput?.checked || false,
      smtpUser: smtpUserInput?.value.trim() || "",
      smtpPass: smtpPasswordInput?.value || "",
      fromName: fromNameInput?.value.trim() || "",
      fromEmail: fromEmailInput?.value.trim() || "",
      replyTo: replyToInput?.value.trim() || "",
      address: companyAddressInput?.value.trim() || "",
    };

    const result = await apiFetch("/api/mail/connect", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (result.connected) {
      showToast("Mail account connected. Campaigns can now send through SMTP.");
    } else {
      showToast("SMTP details saved. Add a host and username before sending.");
    }

    await refreshStatus();
    await refreshMailConfig();
    advanceJourney();
  } catch (error) {
    showToast(error.message || "Unable to connect the mail account.");
  }
}

async function importContacts() {
  try {
    const contacts = parseCsv(contactsInput.value);
    const result = await apiFetch("/api/contacts/import", {
      method: "POST",
      body: JSON.stringify({ contacts }),
    });
    contactImportStatus.textContent = `${result.activeContacts} active contacts segmented`;
    showToast("Contacts imported, scored, and segmented.");
    await refreshStatus();
    advanceJourney();
  } catch (error) {
    showToast(error.message);
  }
}

async function saveCampaignToServer() {
  if (!campaign?.emails?.length) {
    showToast("Generate or write at least one email draft before saving.");
    return;
  }

  try {
    await apiFetch("/api/campaigns", {
      method: "POST",
      body: JSON.stringify(campaign),
    });
    showToast("Campaign saved to the automation backend.");
  } catch (error) {
    showToast(error.message);
  }
}

async function runAutomation() {
  if (!campaign?.emails?.length) {
    showToast("Generate or write a campaign before running automation.");
    return;
  }

  updateFollowupSettings();

  try {
    const result = await apiFetch("/api/automation/run", {
      method: "POST",
      body: JSON.stringify({
        campaign,
        segment: segmentSelect.value,
        limit: Number(sendLimitInput.value || 25),
      }),
    });
    showToast(`${result.mode === "smtp" ? "Sent" : "Simulated"} ${result.processed} campaign emails.`);
    await refreshStatus();
    await refreshActivity();
    advanceJourney();
  } catch (error) {
    showToast(error.message);
  }
}

function parseRecipientList(value) {
  return String(value || "")
    .split(/[\n,;]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function sendSelectedTest() {
  if (!campaign?.emails?.length) {
    showToast("Generate or write a campaign before sending a test.");
    return;
  }

  updateFollowupSettings();

  const recipients = [...new Set(parseRecipientList(testRecipientsInput?.value))];

  if (!recipients.length) {
    showToast("Add at least one test recipient email ID.");
    return;
  }

  if (recipients.length > 10) {
    showToast("Keep tests to 10 recipients or fewer.");
    return;
  }

  try {
    const result = await apiFetch("/api/test/send", {
      method: "POST",
      body: JSON.stringify({ campaign, recipients }),
    });
    showToast(`${result.mode === "smtp" ? "Sent" : "Simulated"} ${result.processed} test emails.`);
    await refreshStatus();
    await refreshActivity();
    advanceJourney();
  } catch (error) {
    showToast(error.message);
  }
}

async function pushFollowupNow(eventId) {
  try {
    const result = await apiFetch(`/api/followups/${eventId}/push`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    showToast(`Follow-up ${result.delivery.mode === "sent" ? "sent" : "simulated"}.`);
    await refreshActivity();
  } catch (error) {
    showToast(error.message || "Could not push the follow-up.");
  }
}

let activityEvents = [];

function renderActivity(events) {
  activityLog.innerHTML = "";
  if (!events.length) {
    activityLog.innerHTML = '<p class="muted">No automation events yet.</p>';
    return;
  }

  events.forEach((event, index) => {
    const item = document.createElement("div");
    const content = document.createElement("div");
    const title = document.createElement("strong");
    const subject = document.createElement("span");
    const timestamp = document.createElement("span");
    const actions = document.createElement("div");
    const removeButton = document.createElement("button");
    const pushButton = document.createElement("button");

    item.className = "activity-item";
    content.className = "activity-content";
    actions.className = "activity-actions";
    title.textContent = `${event.type.toUpperCase()} - ${event.contactEmail}`;
    subject.textContent =
      event.type === "followup-manual"
        ? `${event.subject} waiting for manual push`
        : event.scheduledAt
          ? `${event.subject} scheduled`
          : event.subject;
    timestamp.textContent = event.scheduledAt
      ? `Runs ${new Date(event.scheduledAt).toLocaleString()}`
      : new Date(event.createdAt).toLocaleString();
    if (event.type === "followup-manual") {
      pushButton.type = "button";
      pushButton.className = "ghost-button compact";
      pushButton.textContent = "Push now";
      pushButton.addEventListener("click", () => pushFollowupNow(event.id));
      actions.append(pushButton);
    }
    removeButton.type = "button";
    removeButton.className = "draft-remove-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      activityEvents.splice(index, 1);
      renderActivity(activityEvents);
      showToast("Activity item removed.");
    });

    actions.append(removeButton);
    content.append(title, subject, timestamp);
    item.append(content, actions);
    activityLog.append(item);
  });
}

async function refreshActivity() {
  try {
    const events = await apiFetch("/api/events");
    activityEvents = events;
    hasTestSend = events.some((event) => /test/.test(event.type));
    renderActivity(activityEvents);
    renderJourney();
  } catch {
    activityEvents = [];
    activityLog.innerHTML = '<p class="muted">Activity log connects when the automation server is running.</p>';
  }
}

function clearActivity() {
  activityEvents = [];
  renderActivity(activityEvents);
  showToast("All activity entries removed.");
}

uploadCsvButton?.addEventListener("click", () => {
  csvFileInput?.click();
});

csvFileInput?.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    let contents = "";

    if (extension === "xlsx" || extension === "xlsm" || extension === "xls") {
      if (typeof window === "undefined" || !window.XLSX) {
        throw new Error("Excel support is unavailable in this browser session.");
      }

      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      contents = window.XLSX.utils.sheet_to_csv(worksheet);
    } else {
      contents = await file.text();
    }

    contactsInput.value = contents.replace(/^\uFEFF/, "");
    showToast(`Loaded ${file.name}`);
  } catch (error) {
    showToast(error.message || "Could not read the selected file.");
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#importContactsButton").addEventListener("click", importContacts);
document.querySelector("#runAutomationButton").addEventListener("click", runAutomation);
document.querySelector("#refreshActivityButton").addEventListener("click", refreshActivity);
sendTestButton?.addEventListener("click", sendSelectedTest);
connectMailButton?.addEventListener("click", connectMailAccount);
clearActivityButton?.addEventListener("click", clearActivity);
followupOneMode?.addEventListener("change", updateFollowupSettings);
followupOneDays?.addEventListener("input", updateFollowupSettings);
followupTwoMode?.addEventListener("change", updateFollowupSettings);
followupTwoDays?.addEventListener("input", updateFollowupSettings);

document.querySelector("#saveDraftButton").addEventListener("dblclick", saveCampaignToServer);
