import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import nodemailer from "nodemailer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 5174);
const dataDir = process.env.VERCEL ? path.join("/tmp", "email-automation-data") : path.join(__dirname, "data");
const dbPath = path.join(dataDir, "automation-db.json");

const defaultConfig = {
  baseUrl: process.env.BASE_URL || `http://127.0.0.1:${port}`,
  fromName: process.env.FROM_NAME || "",
  fromEmail: process.env.FROM_EMAIL || "",
  replyTo: process.env.REPLY_TO || "",
  address: process.env.COMPANY_ADDRESS || "",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
};

let config = { ...defaultConfig };

const emptyDb = {
  contacts: [],
  campaigns: [],
  events: [],
  suppressionList: [],
  mailConfig: {},
  inboxMessages: [],
};

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

async function readDb() {
  try {
    const raw = await fs.readFile(dbPath, "utf8");
    return { ...emptyDb, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeDb(emptyDb);
    return { ...emptyDb };
  }
}

async function writeDb(db) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

function mergeConfig(mailConfig = {}) {
  return {
    ...defaultConfig,
    ...config,
    ...mailConfig,
    baseUrl: mailConfig.baseUrl || config.baseUrl || defaultConfig.baseUrl,
    fromName: mailConfig.fromName || config.fromName || defaultConfig.fromName,
    fromEmail: mailConfig.fromEmail || config.fromEmail || defaultConfig.fromEmail,
    replyTo: mailConfig.replyTo || config.replyTo || defaultConfig.replyTo,
    address: mailConfig.address || config.address || defaultConfig.address,
    smtpHost: mailConfig.smtpHost || config.smtpHost || defaultConfig.smtpHost,
    smtpPort: Number(mailConfig.smtpPort || config.smtpPort || defaultConfig.smtpPort || 587),
    smtpSecure: Boolean(mailConfig.smtpSecure ?? config.smtpSecure ?? defaultConfig.smtpSecure),
    smtpUser: mailConfig.smtpUser || config.smtpUser || defaultConfig.smtpUser,
    smtpPass: mailConfig.smtpPass || config.smtpPass || defaultConfig.smtpPass,
  };
}

async function bootstrapConfig() {
  const db = await readDb();
  config = mergeConfig(db.mailConfig || {});
}

await bootstrapConfig();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function scoreContact(contact) {
  let score = 35;
  if (/chief|ceo|cto|cio|vp|director|head/i.test(contact.role || "")) score += 22;
  if (/healthcare|bfsi|manufacturing|fintech/i.test(contact.industry || "")) score += 16;
  if (/data|ai|cloud|microsoft|salesforce/i.test(contact.interest || "")) score += 18;
  if (/webinar|event|referral|website/i.test(contact.source || "")) score += 9;
  return Math.min(score, 100);
}

function segmentContact(contact) {
  const score = scoreContact(contact);
  if (score >= 82) return "Sales priority";
  if (/Data|AI|Cloud/i.test(contact.interest || "")) return "Innovation leaders";
  if (/Microsoft|Salesforce/i.test(contact.interest || "")) return "Platform modernization";
  return "Nurture";
}

function inferContinent(contact) {
  const explicit = String(contact.continent || "").trim();
  if (explicit) return explicit;

  const country = String(contact.country || "").trim().toLowerCase();
  const groups = [
    ["North America", ["usa", "united states", "canada", "mexico"]],
    ["South America", ["brazil", "argentina", "chile", "colombia", "peru"]],
    ["Europe", ["uk", "united kingdom", "germany", "france", "italy", "spain", "netherlands", "ireland"]],
    ["Asia", ["india", "uae", "singapore", "japan", "china", "south korea", "indonesia", "philippines"]],
    ["Africa", ["south africa", "nigeria", "kenya", "egypt", "morocco"]],
    ["Oceania", ["australia", "new zealand"]],
  ];
  const match = groups.find(([, countries]) => countries.includes(country));
  return match ? match[0] : "Unspecified";
}

function isConverted(contact) {
  return (
    contact.converted === true ||
    contact.forwarded === true ||
    String(contact.converted || "").toLowerCase() === "true" ||
    String(contact.forwarded || "").toLowerCase() === "true" ||
    /converted|forwarded|sales|qualified|closed lead|lead closed/i.test(contact.status || contact.lifecycle || "")
  );
}

function complianceIssues(campaign, runtimeConfig = config) {
  const issues = [];
  if (!runtimeConfig.fromEmail.includes("@")) issues.push("Sender email is missing or invalid.");
  if (!runtimeConfig.address) issues.push("Physical postal address is missing.");
  if (!campaign?.emails?.every((email) => email.subject && email.body)) {
    issues.push("Every email needs a subject and body.");
  }
  if (campaign?.emails?.some((email) => /free|guaranteed|urgent!!!/i.test(email.subject))) {
    issues.push("Review subject lines for exaggerated or potentially deceptive wording.");
  }
  return issues;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEmailHtml({ contact, email, campaign, token, runtimeConfig = config }) {
  const unsubscribeUrl = `${runtimeConfig.baseUrl}/unsubscribe/${token}?email=${encodeURIComponent(contact.email)}`;
  const personalizedBody = email.body
    .replaceAll("{{firstName}}", contact.firstName || "there")
    .replaceAll("{{company}}", contact.company || "your team")
    .replaceAll("{{industry}}", contact.industry || "your industry");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#172033;max-width:640px">
      ${personalizedBody
        .split("\n")
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")}
      <p><a href="${campaign.ctaUrl || "https://www.moreyeahs.com/#contact"}">Book a MoreYeahs consultation</a></p>
      <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="font-size:12px;color:#64748b">
        You are receiving this because you showed interest in MoreYeahs services or opted into business updates.
        MoreYeahs, ${escapeHtml(runtimeConfig.address)}.
        <a href="${unsubscribeUrl}">Unsubscribe</a>
      </p>
    </div>
  `;
}

function normalizeSmtpConfig(rawConfig = {}) {
  const smtpPort = Number(rawConfig.smtpPort || 587);
  return {
    ...rawConfig,
    smtpPort,
    smtpSecure: smtpPort === 465 ? true : smtpPort === 587 ? false : Boolean(rawConfig.smtpSecure),
  };
}

function createTransport(runtimeConfig = config) {
  const smtpConfig = normalizeSmtpConfig(runtimeConfig);
  if (!smtpConfig.smtpHost) return null;
  return nodemailer.createTransport({
    host: smtpConfig.smtpHost,
    port: smtpConfig.smtpPort,
    secure: smtpConfig.smtpSecure === true,
    requireTLS: smtpConfig.smtpPort === 587,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 12000,
    auth: smtpConfig.smtpUser
      ? {
          user: smtpConfig.smtpUser,
          pass: smtpConfig.smtpPass,
        }
      : undefined,
  });
}

function formatSmtpError(error) {
  const message = error?.message || "Unknown SMTP error.";
  if (/wrong version|tls_validate_record_header/i.test(message)) {
    return "SMTP connection failed: port 587 must use STARTTLS, not SSL/TLS. Use smtp.office365.com, port 587, with SSL/TLS off.";
  }
  if (/timeout|timed out|etimedout|greeting never received/i.test(message)) {
    return "SMTP connection timed out. Check that SMTP AUTH is enabled for this Microsoft 365 mailbox, then try smtp.office365.com on port 587 with SSL/TLS off.";
  }
  if (/auth|authentication|login|535|5\.7\.3|5\.7\.57/i.test(message)) {
    return `SMTP authentication failed. Check the mailbox password/app password and confirm SMTP AUTH is enabled. Details: ${message}`;
  }
  return `SMTP connection failed: ${message}`;
}

async function sendOrSimulate({ contact, email, campaign, token, runtimeConfig = config }) {
  const transport = createTransport(runtimeConfig);
  const subject = email.subject
    .replaceAll("{{company}}", contact.company || "your team")
    .replaceAll("{{industry}}", contact.industry || "your industry");
  const html = renderEmailHtml({ contact, email, campaign, token, runtimeConfig });

  if (!transport) {
    return {
      mode: "simulation",
      to: contact.email,
      subject,
      preview: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
    };
  }

  const response = await transport.sendMail({
    from: `"${runtimeConfig.fromName}" <${runtimeConfig.fromEmail}>`,
    to: contact.email,
    replyTo: runtimeConfig.replyTo,
    subject,
    html,
  });

  return { mode: "sent", to: contact.email, subject, messageId: response.messageId };
}

async function sendReplyEmail({ to, subject, text, runtimeConfig = config }) {
  const transport = createTransport(runtimeConfig);
  if (!transport) {
    return {
      mode: "simulation",
      to,
      subject,
      preview: text.replace(/\s+/g, " ").trim().slice(0, 180),
    };
  }

  const response = await transport.sendMail({
    from: `"${runtimeConfig.fromName}" <${runtimeConfig.fromEmail}>`,
    to,
    replyTo: runtimeConfig.replyTo,
    subject,
    text,
  });

  return { mode: "sent", to, subject, messageId: response.messageId };
}

app.get("/api/status", async (_request, response) => {
  const db = await readDb();
  const runtimeConfig = mergeConfig(db.mailConfig || {});
  response.json({
    providerMode: runtimeConfig.smtpHost ? "smtp" : "simulation",
    mailConfigured: Boolean(runtimeConfig.smtpHost && runtimeConfig.smtpUser),
    contactCount: db.contacts.length,
    suppressedCount: db.suppressionList.length,
    eventCount: db.events.length,
    config: {
      fromName: runtimeConfig.fromName,
      fromEmail: runtimeConfig.fromEmail,
      replyTo: runtimeConfig.replyTo,
      address: runtimeConfig.address,
    },
  });
});

app.get("/api/mail/config", async (_request, response) => {
  const db = await readDb();
  const runtimeConfig = normalizeSmtpConfig(mergeConfig(db.mailConfig || {}));
  response.json({
    smtpHost: runtimeConfig.smtpHost || "",
    smtpPort: runtimeConfig.smtpPort || 587,
    smtpSecure: Boolean(runtimeConfig.smtpSecure),
    smtpUser: runtimeConfig.smtpUser || "",
    fromName: runtimeConfig.fromName || "",
    fromEmail: runtimeConfig.fromEmail || "",
    replyTo: runtimeConfig.replyTo || "",
    address: runtimeConfig.address || "",
    connected: Boolean(runtimeConfig.smtpHost && runtimeConfig.smtpUser),
  });
});

app.post("/api/mail/connect", async (request, response) => {
  const db = await readDb();
  const incoming = request.body || {};

  if (!incoming.smtpHost || !incoming.smtpUser || !incoming.smtpPass) {
    return response.status(400).json({
      message: "SMTP host, username, and app password are required to connect real sending.",
    });
  }

  const nextConfig = normalizeSmtpConfig(mergeConfig({
    smtpHost: incoming.smtpHost || "",
    smtpPort: Number(incoming.smtpPort || 587),
    smtpSecure: Boolean(incoming.smtpSecure),
    smtpUser: incoming.smtpUser || "",
    smtpPass: incoming.smtpPass || "",
    fromName: incoming.fromName || config.fromName,
    fromEmail: incoming.fromEmail || incoming.smtpUser,
    replyTo: incoming.replyTo || incoming.smtpUser,
    address: incoming.address || "",
  }));

  try {
    await createTransport(nextConfig).verify();
  } catch (error) {
    return response.status(400).json({
      message: formatSmtpError(error),
    });
  }

  db.mailConfig = nextConfig;
  config = mergeConfig(db.mailConfig);
  await writeDb(db);
  response.json({
    connected: Boolean(db.mailConfig.smtpHost && db.mailConfig.smtpUser),
    mailConfig: {
      smtpHost: db.mailConfig.smtpHost,
      smtpUser: db.mailConfig.smtpUser,
      fromEmail: db.mailConfig.fromEmail,
    },
  });
});

app.post("/api/contacts/import", async (request, response) => {
  const db = await readDb();
  const incoming = Array.isArray(request.body.contacts) ? request.body.contacts : [];
  const byEmail = new Map(db.contacts.map((contact) => [contact.email, contact]));

  incoming.forEach((contact) => {
    const email = normalizeEmail(contact.email);
    if (!email || contact.consent === false || String(contact.consent).toLowerCase() === "false") return;
    byEmail.set(email, {
      id: byEmail.get(email)?.id || makeId("contact"),
      email,
      firstName: contact.firstName || "",
      company: contact.company || "",
      role: contact.role || "",
      industry: contact.industry || "",
      country: contact.country || "",
      continent: inferContinent(contact),
      interest: contact.interest || "",
      source: contact.source || "manual",
      status: contact.status || contact.lifecycle || "",
      converted: isConverted(contact),
      forwarded: isConverted(contact),
      consent: true,
      score: scoreContact(contact),
      segment: segmentContact(contact),
      updatedAt: new Date().toISOString(),
    });
  });

  db.contacts = [...byEmail.values()];
  await writeDb(db);
  response.json({ imported: incoming.length, activeContacts: db.contacts.length, contacts: db.contacts });
});

app.get("/api/contacts", async (_request, response) => {
  const db = await readDb();
  response.json(db.contacts);
});

app.post("/api/campaigns", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = mergeConfig(db.mailConfig || {});
  const campaign = {
    id: makeId("campaign"),
    ...request.body,
    createdAt: new Date().toISOString(),
  };
  const issues = complianceIssues(campaign);
  if (issues.length) return response.status(400).json({ issues });
  db.campaigns.unshift(campaign);
  await writeDb(db);
  response.json(campaign);
});

app.post("/api/automation/run", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = mergeConfig(db.mailConfig || {});
  const campaign = request.body.campaign;
  const issues = complianceIssues(campaign, runtimeConfig);
  if (issues.length) return response.status(400).json({ issues });

  const suppressed = new Set(db.suppressionList.map((item) => item.email));
  const selectedContacts = db.contacts
    .filter((contact) => !suppressed.has(contact.email))
    .filter((contact) => !request.body.segment || contact.segment === request.body.segment)
    .slice(0, Number(request.body.limit || 25));

  const results = [];
  const createdEvents = [];
  for (const contact of selectedContacts) {
    const token = crypto.createHash("sha256").update(`${contact.email}:${campaign.id || campaign.offer}`).digest("hex");
    const result = await sendOrSimulate({
      contact,
      email: campaign.emails[0],
      campaign,
      token,
      runtimeConfig,
    });
    results.push(result);
    const openerEvent = {
      id: makeId("event"),
      type: result.mode,
      contactEmail: contact.email,
      campaignName: campaign.offer,
      subject: result.subject,
      createdAt: new Date().toISOString(),
    };
    db.events.unshift(openerEvent);
    createdEvents.push(openerEvent);

    campaign.emails.slice(1).forEach((email) => {
      if (email.followupMode !== "delay") {
        const manualEvent = {
          id: makeId("event"),
          type: "followup-manual",
          contactEmail: contact.email,
          campaignName: campaign.offer,
          subject: email.subject
            .replaceAll("{{company}}", contact.company || "your team")
            .replaceAll("{{industry}}", contact.industry || "your industry"),
          followupEmail: email,
          contactSnapshot: contact,
          campaignSnapshot: campaign,
          createdAt: new Date().toISOString(),
        };
        db.events.unshift(manualEvent);
        createdEvents.push(manualEvent);
        return;
      }

      const delayDays = Math.min(60, Math.max(1, Number(email.followupDelayDays || 1)));
      const scheduledAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString();
      const scheduledEvent = {
        id: makeId("event"),
        type: "followup-scheduled",
        contactEmail: contact.email,
        campaignName: campaign.offer,
        subject: email.subject
          .replaceAll("{{company}}", contact.company || "your team")
          .replaceAll("{{industry}}", contact.industry || "your industry"),
        followupEmail: email,
        contactSnapshot: contact,
        campaignSnapshot: campaign,
        scheduledAt,
        delayDays,
        createdAt: new Date().toISOString(),
      };
      db.events.unshift(scheduledEvent);
      createdEvents.push(scheduledEvent);
    });
  }

  await writeDb(db);
  response.json({ mode: runtimeConfig.smtpHost ? "smtp" : "simulation", processed: results.length, results, events: createdEvents });
});

app.post("/api/followups/:id/push", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = mergeConfig(db.mailConfig || {});
  const event = db.events.find((item) => item.id === request.params.id);

  if (!event) return response.status(404).json({ message: "Follow-up event not found." });
  if (!event.followupEmail || !event.contactSnapshot || !event.campaignSnapshot) {
    return response.status(400).json({ message: "This event does not contain a pushable follow-up draft." });
  }

  const token = crypto
    .createHash("sha256")
    .update(`${event.contactEmail}:${event.campaignName}:${event.id}:manual-followup`)
    .digest("hex");
  const result = await sendOrSimulate({
    contact: event.contactSnapshot,
    email: event.followupEmail,
    campaign: event.campaignSnapshot,
    token,
    runtimeConfig,
  });

  event.type = result.mode === "sent" ? "followup-sent" : "followup-simulation";
  event.pushedAt = new Date().toISOString();
  event.subject = result.subject;
  db.events.unshift({
    id: makeId("event"),
    type: event.type,
    contactEmail: event.contactEmail,
    campaignName: event.campaignName,
    subject: result.subject,
    createdAt: event.pushedAt,
  });

  await writeDb(db);
  response.json({ delivery: result });
});

app.post("/api/test/send", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = mergeConfig(db.mailConfig || {});
  const campaign = request.body.campaign;
  const recipients = Array.isArray(request.body.recipients)
    ? [...new Set(request.body.recipients.map(normalizeEmail).filter(Boolean))]
    : [];

  if (!recipients.length) {
    return response.status(400).json({ message: "Add at least one test recipient email ID." });
  }

  if (recipients.length > 10) {
    return response.status(400).json({ message: "Test sends are capped at 10 recipients." });
  }

  const issues = complianceIssues(campaign, runtimeConfig);
  if (issues.length) return response.status(400).json({ issues });

  const suppressed = new Set(db.suppressionList.map((item) => item.email));
  const selectedContacts = recipients
    .filter((email) => !suppressed.has(email))
    .map((email) => {
      const existing = db.contacts.find((contact) => contact.email === email);
      return {
        email,
        firstName: existing?.firstName || "there",
        company: existing?.company || "your team",
        role: existing?.role || "Test recipient",
        industry: existing?.industry || "your industry",
        interest: existing?.interest || campaign.offer || "MoreYeahs services",
        source: "selected-test",
        consent: true,
      };
    });

  const attempts = await Promise.all(selectedContacts.map(async (contact) => {
    const token = crypto.createHash("sha256").update(`${contact.email}:${campaign.id || campaign.offer}:test`).digest("hex");
    try {
      const result = await sendOrSimulate({
        contact,
        email: campaign.emails[0],
        campaign,
        token,
        runtimeConfig,
      });

      return {
        result,
        event: {
          id: makeId("event"),
          type: result.mode === "sent" ? "test-sent" : "test-simulation",
          contactEmail: contact.email,
          campaignName: campaign.offer,
          subject: result.subject,
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return { failure: { email: contact.email, message: formatSmtpError(error) } };
    }
  }));

  const results = attempts.map((attempt) => attempt.result).filter(Boolean);
  const failures = attempts.map((attempt) => attempt.failure).filter(Boolean);
  const createdEvents = attempts.map((attempt) => attempt.event).filter(Boolean);
  attempts
    .map((attempt) => attempt.event)
    .filter(Boolean)
    .forEach((event) => db.events.unshift(event));

  await writeDb(db);
  if (failures.length) {
    return response.status(400).json({
      message: `${failures.length} test email${failures.length === 1 ? "" : "s"} failed. ${failures[0].message}`,
      processed: results.length,
      failures,
    });
  }
  response.json({ mode: runtimeConfig.smtpHost ? "smtp" : "simulation", processed: results.length, results, events: createdEvents });
});

app.get("/api/events", async (_request, response) => {
  const db = await readDb();
  response.json(db.events.slice(0, 50));
});

app.get("/api/dashboard", async (_request, response) => {
  const db = await readDb();
  const sentTypes = new Set(["sent", "test-sent", "followup-sent"]);
  const simulatedTypes = new Set(["simulation", "test-simulation", "followup-simulation"]);
  const sentEvents = db.events.filter((event) => sentTypes.has(event.type));
  const simulatedEvents = db.events.filter((event) => simulatedTypes.has(event.type));
  const revertedEmails = new Set((db.inboxMessages || []).map((message) => normalizeEmail(message.email)).filter(Boolean));
  const convertedContacts = db.contacts.filter(isConverted);
  const contactsByEmail = new Map(db.contacts.map((contact) => [contact.email, contact]));
  const continentMap = new Map();

  [...sentEvents, ...simulatedEvents].forEach((event) => {
    const contact = contactsByEmail.get(event.contactEmail);
    const continent = contact ? inferContinent(contact) : "Unspecified";
    const current = continentMap.get(continent) || { continent, sent: 0, simulated: 0, reverts: 0, converted: 0 };
    if (sentTypes.has(event.type)) current.sent += 1;
    if (simulatedTypes.has(event.type)) current.simulated += 1;
    continentMap.set(continent, current);
  });

  db.contacts.forEach((contact) => {
    const continent = inferContinent(contact);
    const current = continentMap.get(continent) || { continent, sent: 0, simulated: 0, reverts: 0, converted: 0 };
    if (revertedEmails.has(contact.email)) current.reverts += 1;
    if (isConverted(contact)) current.converted += 1;
    continentMap.set(continent, current);
  });

  response.json({
    totals: {
      contacts: db.contacts.length,
      sent: sentEvents.length,
      simulated: simulatedEvents.length,
      reverts: revertedEmails.size,
      converted: convertedContacts.length,
    },
    continents: [...continentMap.values()].sort((a, b) => (b.sent + b.simulated) - (a.sent + a.simulated)),
    recentEvents: db.events.slice(0, 12),
  });
});

app.get("/api/inbox", async (_request, response) => {
  const db = await readDb();
  response.json(db.inboxMessages.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)));
});

app.post("/api/inbox/:id/reply", async (request, response) => {
  const db = await readDb();
  const message = db.inboxMessages?.find((item) => item.id === request.params.id);
  if (!message) return response.status(404).json({ message: "Inbox message not found." });

  const runtimeConfig = mergeConfig(db.mailConfig || {});
  const body = String(request.body?.body || "").trim();
  const mode = request.body?.mode === "manual" ? "manual" : "auto";
  const draft = body;

  if (!draft) return response.status(400).json({ message: "A reply message is required." });

  const outbound = await sendReplyEmail({
    to: message.email,
    subject: `Re: ${message.subject}`,
    text: draft,
    runtimeConfig,
  });

  message.replies = Array.isArray(message.replies) ? message.replies : [];
  message.replies.unshift({
    id: makeId("reply"),
    body: draft,
    mode,
    sentAt: new Date().toISOString(),
    status: outbound.mode,
  });
  message.lastReplyAt = new Date().toISOString();
  await writeDb(db);
  response.json({ reply: message.replies[0], delivery: outbound });
});

app.get("/unsubscribe/:token", async (request, response) => {
  const db = await readDb();
  const email = normalizeEmail(request.query.email);
  db.suppressionList.unshift({
    token: request.params.token,
    email: email || "tokenized-recipient",
    createdAt: new Date().toISOString(),
  });
  await writeDb(db);
  response.send("<h1>You have been unsubscribed</h1><p>Your marketing opt-out has been recorded.</p>");
});

app.use((error, request, response, next) => {
  if (!request.path.startsWith("/api/")) return next(error);
  console.error(error);
  response.status(500).json({
    message: error?.message ? `Server error: ${error.message}` : "Server error. Please try again.",
  });
});

if (!process.env.VERCEL) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`MoreYeahs email automation running at http://127.0.0.1:${port}`);
    console.log(`Provider mode: ${process.env.SMTP_HOST ? "SMTP sending" : "safe simulation"}`);
  });
}

export default app;
