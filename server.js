import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

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
  graphTenantId: process.env.MICROSOFT_TENANT_ID || process.env.AZURE_TENANT_ID || "consumers",
  graphClientId: process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_CLIENT_ID || "",
  graphClientSecret: process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || "",
  graphRedirectUri: process.env.MICROSOFT_REDIRECT_URI || process.env.AZURE_REDIRECT_URI || "",
};

let config = { ...defaultConfig };
const authSecret = process.env.AUTH_SECRET || "email-automation-local-auth-secret";
const adminEmail = process.env.ADMIN_EMAIL || "bhavya.moreyeahs@gmail.com";
const adminPassword = process.env.ADMIN_PASSWORD || "Letsgoo@000";
const graphCookieName = "emailAutomationGraph";

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
  const graphEmail = mailConfig.graphEmail ?? config.graphEmail ?? "";
  return {
    ...defaultConfig,
    ...config,
    ...mailConfig,
    baseUrl: mailConfig.baseUrl || config.baseUrl || defaultConfig.baseUrl,
    fromName: mailConfig.fromName || config.fromName || defaultConfig.fromName,
    fromEmail: mailConfig.fromEmail || config.fromEmail || graphEmail || defaultConfig.fromEmail,
    replyTo: mailConfig.replyTo || config.replyTo || graphEmail || defaultConfig.replyTo,
    address: mailConfig.address || config.address || defaultConfig.address,
    graphTenantId: config.graphTenantId || defaultConfig.graphTenantId,
    graphClientId: config.graphClientId || defaultConfig.graphClientId,
    graphClientSecret: config.graphClientSecret || defaultConfig.graphClientSecret,
    graphRedirectUri: config.graphRedirectUri || defaultConfig.graphRedirectUri,
    graphConnected: Boolean(mailConfig.graphConnected ?? config.graphConnected ?? false),
    graphEmail,
    graphAccessToken: mailConfig.graphAccessToken ?? config.graphAccessToken ?? "",
    graphRefreshToken: mailConfig.graphRefreshToken ?? config.graphRefreshToken ?? "",
    graphExpiresAt: Number(mailConfig.graphExpiresAt ?? config.graphExpiresAt ?? 0),
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

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signToken(payload) {
  const encoded = base64urlJson(payload);
  const signature = crypto.createHmac("sha256", authSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyToken(token = "") {
  try {
    const [encoded, signature] = String(token).split(".");
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac("sha256", authSecret).update(encoded).digest("base64url");
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieValue(request, name) {
  return String(request.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? " Secure;" : "";
  return `emailAutomationSession=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${30 * 24 * 60 * 60}`;
}

function graphConnectionCookie(mailConfig = {}) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? " Secure;" : "";
  const token = signToken({
    graphConnected: true,
    graphEmail: normalizeEmail(mailConfig.graphEmail),
    graphRefreshToken: mailConfig.graphRefreshToken || "",
    fromName: mailConfig.fromName || "",
    fromEmail: normalizeEmail(mailConfig.fromEmail || mailConfig.graphEmail),
    replyTo: normalizeEmail(mailConfig.replyTo || mailConfig.graphEmail),
    exp: Date.now() + 90 * 24 * 60 * 60 * 1000,
  });
  return `${graphCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${90 * 24 * 60 * 60}`;
}

function clearGraphConnectionCookie() {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? " Secure;" : "";
  return `${graphCookieName}=; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=0`;
}

function graphConnectionFromRequest(request) {
  const payload = verifyToken(decodeURIComponent(cookieValue(request, graphCookieName)));
  if (!payload?.graphRefreshToken || !payload?.graphEmail) return {};
  return {
    graphConnected: true,
    graphEmail: normalizeEmail(payload.graphEmail),
    graphRefreshToken: payload.graphRefreshToken,
    fromName: payload.fromName || "",
    fromEmail: normalizeEmail(payload.fromEmail || payload.graphEmail),
    replyTo: normalizeEmail(payload.replyTo || payload.graphEmail),
  };
}

function mailConfigForRequest(request, db) {
  return mergeConfig({ ...(db.mailConfig || {}), ...graphConnectionFromRequest(request) });
}

function requestTokens(request) {
  return [
    String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""),
    decodeURIComponent(cookieValue(request, "emailAutomationSession")),
  ].filter(Boolean);
}

function verifyRequestSession(request) {
  for (const token of requestTokens(request)) {
    const session = verifyToken(token);
    if (session) return { token, session };
  }
  return { token: "", session: null };
}

function requireAuth(request, response, next) {
  const publicPaths = new Set(["/api/auth/login", "/api/auth/session"]);
  if (publicPaths.has(request.path)) return next();
  const { session } = verifyRequestSession(request);
  if (!session) return response.status(401).json({ message: "Please login again to continue." });
  request.session = session;
  next();
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

function senderEmailFor(runtimeConfig = config) {
  return normalizeEmail(runtimeConfig.graphEmail || runtimeConfig.fromEmail || "");
}

function senderEmailIssue(runtimeConfig = config) {
  const graphEmail = normalizeEmail(runtimeConfig.graphEmail || "");
  const fromEmail = normalizeEmail(runtimeConfig.fromEmail || "");
  if (graphEmail.includes("@")) return "";
  if (fromEmail.includes("@")) return "";
  if (runtimeConfig.graphConnected || runtimeConfig.graphRefreshToken) {
    return "Sender email is missing because the Microsoft Graph connection did not save a mailbox address. Reconnect Microsoft Graph from Mailbox, then save sender details again.";
  }
  return "Sender email is missing because no Microsoft Graph mailbox is connected. Connect Microsoft Graph from Mailbox before launching.";
}

function complianceIssues(campaign, runtimeConfig = config) {
  const issues = [];
  const senderIssue = senderEmailIssue(runtimeConfig);
  if (senderIssue) issues.push(senderIssue);
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
        <a href="${unsubscribeUrl}">Unsubscribe</a>
      </p>
    </div>
  `;
}

function graphRedirectUri(runtimeConfig = config) {
  return runtimeConfig.graphRedirectUri || `${runtimeConfig.baseUrl}/api/microsoft/callback`;
}

function graphAuthority(runtimeConfig = config) {
  return `https://login.microsoftonline.com/${runtimeConfig.graphTenantId || "organizations"}/oauth2/v2.0`;
}

function graphScopes() {
  return ["offline_access", "User.Read", "Mail.Send", "Mail.Read"];
}

function hasGraphConnection(runtimeConfig = config) {
  return Boolean(runtimeConfig.graphConnected && runtimeConfig.graphRefreshToken && runtimeConfig.graphEmail);
}

function hasGraphApp(runtimeConfig = config) {
  return Boolean(runtimeConfig.graphClientId && runtimeConfig.graphClientSecret);
}

function providerMode(runtimeConfig = config) {
  if (hasGraphConnection(runtimeConfig)) return "graph";
  return "simulation";
}

function graphState() {
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", authSecret).update(nonce).digest("base64url");
  return `${nonce}.${signature}`;
}

function verifyGraphState(state = "") {
  const [nonce, signature] = String(state).split(".");
  if (!nonce || !signature) return false;
  const expected = crypto.createHmac("sha256", authSecret).update(nonce).digest("base64url");
  return Buffer.byteLength(signature) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function requestGraphToken(params, runtimeConfig = config) {
  const tokenResponse = await fetch(`${graphAuthority(runtimeConfig)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: runtimeConfig.graphClientId,
      client_secret: runtimeConfig.graphClientSecret,
      ...params,
    }),
  });
  const payload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    throw new Error(payload.error_description || payload.error || "Microsoft token request failed.");
  }
  return payload;
}

async function refreshGraphTokens(db, runtimeConfig = mergeConfig(db.mailConfig || {}), response = null) {
  if (!hasGraphApp(runtimeConfig) || !runtimeConfig.graphRefreshToken) {
    throw new Error("Microsoft Graph is not connected yet.");
  }

  if (runtimeConfig.graphAccessToken && Number(runtimeConfig.graphExpiresAt || 0) > Date.now() + 90_000) {
    return runtimeConfig;
  }

  const token = await requestGraphToken({
    grant_type: "refresh_token",
    refresh_token: runtimeConfig.graphRefreshToken,
    redirect_uri: graphRedirectUri(runtimeConfig),
    scope: graphScopes().join(" "),
  }, runtimeConfig);

  db.mailConfig = {
    ...(db.mailConfig || {}),
    fromName: runtimeConfig.fromName || db.mailConfig?.fromName || "",
    fromEmail: runtimeConfig.fromEmail || runtimeConfig.graphEmail || db.mailConfig?.fromEmail || "",
    replyTo: runtimeConfig.replyTo || runtimeConfig.graphEmail || db.mailConfig?.replyTo || "",
    graphConnected: true,
    graphEmail: runtimeConfig.graphEmail,
    graphAccessToken: token.access_token,
    graphRefreshToken: token.refresh_token || runtimeConfig.graphRefreshToken,
    graphExpiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
  };
  await writeDb(db);
  config = mergeConfig(db.mailConfig);
  if (response) response.setHeader("Set-Cookie", graphConnectionCookie(config));
  return mergeConfig(db.mailConfig);
}

async function graphFetch(pathname, options = {}, runtimeConfig = config) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${runtimeConfig.graphAccessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Microsoft Graph request failed.");
  }
  return payload;
}

async function sendGraphMail({ to, subject, html, text, runtimeConfig = config }) {
  await graphFetch(`/users/${encodeURIComponent(runtimeConfig.graphEmail)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: {
          contentType: html ? "HTML" : "Text",
          content: html || text,
        },
        toRecipients: [
          {
            emailAddress: { address: to },
          },
        ],
        replyTo: normalizeEmail(runtimeConfig.replyTo).includes("@")
          ? [{ emailAddress: { address: normalizeEmail(runtimeConfig.replyTo) } }]
          : undefined,
      },
      saveToSentItems: true,
    }),
  }, runtimeConfig);
  return { mode: "sent", provider: "graph", to, subject, messageId: makeId("graph") };
}

const replyEligibleEventTypes = new Set(["sent", "test-sent", "followup-sent"]);

function normalizeReplySubject(subject = "") {
  return String(subject || "")
    .toLowerCase()
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildReplyMatchIndex(db) {
  const index = new Map();
  (db.events || [])
    .filter((event) => replyEligibleEventTypes.has(event.type) && normalizeEmail(event.contactEmail))
    .forEach((event) => {
      const email = normalizeEmail(event.contactEmail);
      const entries = index.get(email) || [];
      entries.push({
        campaignName: event.campaignName || "Campaign",
        createdAt: event.createdAt || event.pushedAt || new Date(0).toISOString(),
        subject: event.subject || "",
        normalizedSubject: normalizeReplySubject(event.subject || ""),
      });
      index.set(email, entries);
    });

  index.forEach((entries) => {
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  });
  return index;
}

function matchCampaignReply(message, replyIndex) {
  const email = normalizeEmail(message.email);
  const entries = replyIndex.get(email) || [];
  if (!entries.length) return null;

  const receivedAt = new Date(message.receivedAt || Date.now()).getTime();
  const subject = String(message.subject || "");
  const normalizedSubject = normalizeReplySubject(subject);
  const body = normalizeReplySubject(`${message.preview || ""} ${message.body || ""}`);
  const isReplyLike = /^\s*((re|fw|fwd)\s*:)/i.test(subject);

  return entries.find((entry) => {
    const sentAt = new Date(entry.createdAt || 0).getTime();
    if (Number.isFinite(receivedAt) && Number.isFinite(sentAt) && receivedAt < sentAt - 5 * 60 * 1000) return false;
    if (!entry.normalizedSubject || entry.normalizedSubject.length < 6) return isReplyLike;
    const hasUsefulSubject = normalizedSubject.length >= 6;
    return (
      (hasUsefulSubject && normalizedSubject.includes(entry.normalizedSubject)) ||
      (hasUsefulSubject && entry.normalizedSubject.includes(normalizedSubject)) ||
      body.includes(entry.normalizedSubject)
    );
  }) || null;
}

async function fetchGraphInboxMessages(db, runtimeConfig = mergeConfig(db.mailConfig || {}), response = null) {
  runtimeConfig = await refreshGraphTokens(db, runtimeConfig, response);
  const payload = await graphFetch(
    `/users/${encodeURIComponent(runtimeConfig.graphEmail)}/mailFolders/inbox/messages?$top=100&$orderby=receivedDateTime desc&$select=id,subject,from,bodyPreview,receivedDateTime,body`,
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
    runtimeConfig,
  );
  const selfEmail = normalizeEmail(runtimeConfig.graphEmail || runtimeConfig.fromEmail);
  const replyIndex = buildReplyMatchIndex(db);
  return (payload.value || [])
    .map((message) => {
      const from = message.from?.emailAddress || {};
      const email = normalizeEmail(from.address);
      const body = String(message.body?.content || message.bodyPreview || "").replace(/\s+/g, " ").trim();
      return {
        id: `graph_${message.id}`,
        messageId: message.id,
        name: from.name || "",
        email,
        subject: message.subject || "(No subject)",
        preview: String(message.bodyPreview || body).slice(0, 180),
        body: body || "(No readable message body)",
        receivedAt: message.receivedDateTime || new Date().toISOString(),
        source: "graph",
      };
    })
    .filter((message) => message.email && message.email !== selfEmail)
    .map((message) => {
      const matched = matchCampaignReply(message, replyIndex);
      return matched
        ? {
            ...message,
            campaignName: matched.campaignName,
            matchedSubject: matched.subject,
            sentAt: matched.createdAt,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

function formatDeliveryError(error) {
  const message = error?.message || "Unknown delivery error.";
  if (/account suspended|WASCL|Actual verdict is Suspend|ShowTierUpgrade/i.test(message)) {
    return "Microsoft Graph send failed because this mailbox is suspended for outbound sending. Open the connected Outlook inbox, complete Microsoft account verification/security prompts, then reconnect Microsoft Graph and try again. Details: " + message;
  }
  if (/Forbidden|ErrorAccessDenied|Authorization_RequestDenied|insufficient privileges|permission/i.test(message)) {
    return "Microsoft Graph send failed because this app or mailbox does not have permission to send. Reconnect Microsoft Graph and confirm Mail.Send permission is granted. Details: " + message;
  }
  if (/Microsoft Graph|Graph mailbox|Connect Microsoft Graph/i.test(message)) return message;
  return `Microsoft Graph send failed: ${message}`;
}

function isBlockingDeliveryError(error) {
  const message = error?.message || "";
  return /account suspended|mailbox is suspended|WASCL|Actual verdict is Suspend|ShowTierUpgrade|Forbidden|ErrorAccessDenied|Authorization_RequestDenied|insufficient privileges|permission/i.test(message);
}

async function sendOrSimulate({ contact, email, campaign, token, runtimeConfig = config }) {
  const subject = email.subject
    .replaceAll("{{company}}", contact.company || "your team")
    .replaceAll("{{industry}}", contact.industry || "your industry");
  const html = renderEmailHtml({ contact, email, campaign, token, runtimeConfig });

  if (hasGraphConnection(runtimeConfig) && runtimeConfig.graphAccessToken) {
    return sendGraphMail({ to: contact.email, subject, html, runtimeConfig });
  }

  throw new Error("Microsoft Graph mailbox is not connected. Connect Microsoft Graph from Mailbox before sending.");
}

async function sendReplyEmail({ to, subject, text, runtimeConfig = config }) {
  if (hasGraphConnection(runtimeConfig) && runtimeConfig.graphAccessToken) {
    return sendGraphMail({ to, subject, text, runtimeConfig });
  }

  throw new Error("Microsoft Graph mailbox is not connected. Connect Microsoft Graph from Mailbox before replying.");
}

async function runtimeConfigForRequest(db, override = {}, { refreshGraph = false, request = null, response = null } = {}) {
  const baseConfig = request ? mailConfigForRequest(request, db) : mergeConfig(db.mailConfig || {});
  const runtimeConfig = mergeConfig({ ...baseConfig, ...(override || {}) });
  if (refreshGraph && hasGraphConnection(runtimeConfig)) {
    const refreshedConfig = await refreshGraphTokens(db, runtimeConfig, response);
    const graphEmail = normalizeEmail(refreshedConfig.graphEmail || "");
    if (graphEmail && (!normalizeEmail(refreshedConfig.fromEmail).includes("@") || !normalizeEmail(refreshedConfig.replyTo).includes("@"))) {
      db.mailConfig = {
        ...(db.mailConfig || {}),
        fromEmail: normalizeEmail(refreshedConfig.fromEmail).includes("@") ? refreshedConfig.fromEmail : graphEmail,
        replyTo: normalizeEmail(refreshedConfig.replyTo).includes("@") ? refreshedConfig.replyTo : graphEmail,
      };
      await writeDb(db);
      config = mergeConfig(db.mailConfig);
      if (response) response.setHeader("Set-Cookie", graphConnectionCookie(config));
      return mergeConfig(db.mailConfig);
    }
    return refreshedConfig;
  }
  return runtimeConfig;
}

async function sendFollowupEvent(db, event, runtimeConfig) {
  if (!event?.followupEmail || !event.contactSnapshot || !event.campaignSnapshot) {
    throw new Error("This event does not contain a pushable follow-up draft.");
  }

  const token = crypto
    .createHash("sha256")
    .update(`${event.contactEmail}:${event.campaignName}:${event.id}:followup`)
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

  const createdEvent = {
    id: makeId("event"),
    type: event.type,
    contactEmail: event.contactEmail,
    campaignName: event.campaignName,
    subject: result.subject,
    createdAt: event.pushedAt,
  };
  db.events.unshift(createdEvent);

  return { result, event: createdEvent };
}

function formatInboxError(error) {
  const details = [error?.message, error?.responseText, error?.code].filter(Boolean).join(" - ");
  const message = details || "Unknown inbox sync error.";
  if (/auth|authentication|login|invalid credentials|AUTHENTICATE/i.test(message)) {
    return `Microsoft Graph inbox authentication failed. Reconnect Microsoft Graph from Mailbox and grant Mail.Read permission. Details: ${message}`;
  }
  if (/timeout|timed out|etimedout/i.test(message)) {
    return "Microsoft Graph inbox sync timed out. Reconnect the mailbox and try again.";
  }
  if (/command failed/i.test(message)) {
    return "Microsoft Graph rejected the inbox sync request. Reconnect the mailbox and confirm Mail.Read permission is granted.";
  }
  return `Inbox sync failed: ${message}`;
}

app.post("/api/auth/login", (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || "");
  const workspace = String(request.body?.workspace || "MoreYeahs workspace").trim();

  if (!email || !password) {
    return response.status(400).json({ message: "Email and password are required." });
  }

  if (email !== normalizeEmail(adminEmail) || password !== adminPassword) {
    return response.status(401).json({ message: "Invalid login credentials." });
  }

  const session = {
    email,
    workspace,
    signedInAt: new Date().toISOString(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };

  const token = signToken(session);
  response.setHeader("Set-Cookie", sessionCookie(token));
  response.json({ token, session: { email, workspace, signedInAt: session.signedInAt } });
});

app.get("/api/auth/session", (request, response) => {
  const { token, session } = verifyRequestSession(request);
  if (!session) return response.status(401).json({ message: "Session expired." });
  response.json({ token, session: { email: session.email, workspace: session.workspace, signedInAt: session.signedInAt } });
});

app.get("/api/cron/followups", async (request, response) => {
  if (process.env.CRON_SECRET && request.query.secret !== process.env.CRON_SECRET) {
    return response.status(401).json({ message: "Invalid cron secret." });
  }

  const db = await readDb();
  const runtimeConfig = await runtimeConfigForRequest(db, {}, { refreshGraph: true });
  const due = db.events
    .filter((event) => event.type === "followup-scheduled" && event.scheduledAt && new Date(event.scheduledAt) <= new Date())
    .slice(0, 25);
  const processed = [];
  const failures = [];

  for (const event of due) {
    try {
      processed.push(await sendFollowupEvent(db, event, runtimeConfig));
    } catch (error) {
      failures.push({ id: event.id, contactEmail: event.contactEmail, message: formatDeliveryError(error) });
      if (isBlockingDeliveryError(error)) break;
    }
  }

  await writeDb(db);
  response.json({ processed: processed.length, failures, events: processed.map((item) => item.event) });
});

app.get("/api/microsoft/callback", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = mergeConfig(db.mailConfig || {});
  const error = request.query.error_description || request.query.error;

  if (error) {
    return response.redirect(`/mailbox.html?graph=error&message=${encodeURIComponent(String(error))}`);
  }

  if (!verifyGraphState(request.query.state)) {
    return response.redirect("/mailbox.html?graph=error&message=Invalid%20Microsoft%20OAuth%20state.");
  }

  if (!hasGraphApp(runtimeConfig)) {
    return response.redirect("/mailbox.html?graph=error&message=Microsoft%20Graph%20environment%20variables%20are%20missing.");
  }

  try {
    const token = await requestGraphToken({
      grant_type: "authorization_code",
      code: String(request.query.code || ""),
      redirect_uri: graphRedirectUri(runtimeConfig),
      scope: graphScopes().join(" "),
    }, runtimeConfig);

    const connectedConfig = mergeConfig({
      ...(db.mailConfig || {}),
      graphConnected: true,
      graphAccessToken: token.access_token,
      graphRefreshToken: token.refresh_token,
      graphExpiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    });
    const profile = await graphFetch("/me?$select=displayName,mail,userPrincipalName", {}, connectedConfig);
    const graphEmail = normalizeEmail(profile.mail || profile.userPrincipalName);

    db.mailConfig = {
      ...(db.mailConfig || {}),
      provider: "graph",
      graphConnected: true,
      graphEmail,
      graphAccessToken: token.access_token,
      graphRefreshToken: token.refresh_token,
      graphExpiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      fromName: db.mailConfig?.fromName || profile.displayName || graphEmail,
      fromEmail: db.mailConfig?.fromEmail || graphEmail,
      replyTo: db.mailConfig?.replyTo || graphEmail,
    };
    config = mergeConfig(db.mailConfig);
    await writeDb(db);
    response.setHeader("Set-Cookie", graphConnectionCookie(config));
    response.redirect(`/mailbox.html?graph=connected&email=${encodeURIComponent(graphEmail)}`);
  } catch (callbackError) {
    response.redirect(`/mailbox.html?graph=error&message=${encodeURIComponent(callbackError.message || "Microsoft connection failed.")}`);
  }
});

app.use("/api", requireAuth);

app.get("/api/microsoft/auth-url", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = mailConfigForRequest(request, db);
  if (!hasGraphApp(runtimeConfig)) {
    return response.status(400).json({
      message: "Microsoft Graph is not configured yet. Add MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID, and BASE_URL/MICROSOFT_REDIRECT_URI in Vercel.",
    });
  }

  const params = new URLSearchParams({
    client_id: runtimeConfig.graphClientId,
    response_type: "code",
    redirect_uri: graphRedirectUri(runtimeConfig),
    response_mode: "query",
    scope: graphScopes().join(" "),
    state: graphState(),
    prompt: "consent",
  });
  response.json({
    url: `${graphAuthority(runtimeConfig)}/authorize?${params}`,
    redirectUri: graphRedirectUri(runtimeConfig),
  });
});

app.post("/api/microsoft/disconnect", async (_request, response) => {
  const db = await readDb();
  db.mailConfig = {
    ...(db.mailConfig || {}),
    provider: "",
    graphConnected: false,
    graphEmail: "",
    graphAccessToken: "",
    graphRefreshToken: "",
    graphExpiresAt: 0,
  };
  config = mergeConfig(db.mailConfig);
  await writeDb(db);
  response.setHeader("Set-Cookie", clearGraphConnectionCookie());
  response.json({ graphConfigured: hasGraphApp(config), graphConnected: false, graphEmail: "" });
});

app.get("/api/status", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = mailConfigForRequest(request, db);
  const senderEmail = senderEmailFor(runtimeConfig);
  response.json({
    providerMode: providerMode(runtimeConfig),
    mailConfigured: Boolean(hasGraphConnection(runtimeConfig)),
    graphConfigured: hasGraphApp(runtimeConfig),
    graphConnected: hasGraphConnection(runtimeConfig),
    graphEmail: runtimeConfig.graphEmail || "",
    contactCount: db.contacts.length,
    suppressedCount: db.suppressionList.length,
    eventCount: db.events.length,
    config: {
      fromName: runtimeConfig.fromName,
      fromEmail: senderEmail,
      replyTo: normalizeEmail(runtimeConfig.replyTo).includes("@") ? runtimeConfig.replyTo : senderEmail,
      address: runtimeConfig.address,
    },
  });
});

app.get("/api/mail/config", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = mailConfigForRequest(request, db);
  const senderEmail = senderEmailFor(runtimeConfig);
  response.json({
    fromName: runtimeConfig.fromName || "",
    fromEmail: senderEmail,
    replyTo: normalizeEmail(runtimeConfig.replyTo).includes("@") ? runtimeConfig.replyTo : senderEmail,
    address: runtimeConfig.address || "",
    graphConfigured: hasGraphApp(runtimeConfig),
    graphConnected: hasGraphConnection(runtimeConfig),
    graphEmail: runtimeConfig.graphEmail || "",
    providerMode: providerMode(runtimeConfig),
    connected: Boolean(hasGraphConnection(runtimeConfig)),
  });
});

app.post("/api/mail/profile", async (request, response) => {
  const db = await readDb();
  const incoming = request.body || {};
  const runtimeConfig = mailConfigForRequest(request, db);

  if (!hasGraphConnection(runtimeConfig)) {
    return response.status(400).json({
      message: "Connect Microsoft Graph before saving sender details.",
    });
  }

  const nextProfile = {
    fromName: String(incoming.fromName || runtimeConfig.fromName || "").trim(),
    fromEmail: normalizeEmail(incoming.fromEmail || runtimeConfig.fromEmail || runtimeConfig.graphEmail || ""),
    replyTo: normalizeEmail(incoming.replyTo || runtimeConfig.replyTo || runtimeConfig.graphEmail || ""),
  };

  if (!nextProfile.fromEmail.includes("@")) {
    return response.status(400).json({ message: senderEmailIssue(runtimeConfig) || "Sender email is missing or invalid." });
  }

  db.mailConfig = {
    ...(db.mailConfig || {}),
    provider: "graph",
    graphConnected: true,
    graphEmail: runtimeConfig.graphEmail,
    graphAccessToken: runtimeConfig.graphAccessToken || db.mailConfig?.graphAccessToken || "",
    graphRefreshToken: runtimeConfig.graphRefreshToken || db.mailConfig?.graphRefreshToken || "",
    graphExpiresAt: runtimeConfig.graphExpiresAt || db.mailConfig?.graphExpiresAt || 0,
    ...nextProfile,
  };
  config = mergeConfig(db.mailConfig);
  await writeDb(db);
  response.setHeader("Set-Cookie", graphConnectionCookie(config));
  response.json({
    connected: Boolean(hasGraphConnection(config)),
    providerMode: providerMode(config),
    graphConnected: hasGraphConnection(config),
    graphEmail: config.graphEmail || "",
    ...nextProfile,
  });
});

app.post("/api/mail/connect", async (_request, response) => {
  response.status(410).json({
    message: "SMTP and IMAP setup has been removed. Connect Microsoft Graph from the Mailbox page instead.",
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
  const runtimeConfig = mailConfigForRequest(request, db);
  const campaign = {
    id: makeId("campaign"),
    ...request.body,
    createdAt: new Date().toISOString(),
  };
  const issues = complianceIssues(campaign, runtimeConfig);
  if (issues.length) return response.status(400).json({ issues });
  db.campaigns.unshift(campaign);
  await writeDb(db);
  response.json(campaign);
});

app.post("/api/automation/run", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = await runtimeConfigForRequest(db, request.body.mailbox, { refreshGraph: true, request, response });
  const campaign = request.body.campaign;
  const issues = complianceIssues(campaign, runtimeConfig);
  if (issues.length) return response.status(400).json({ issues });

  const suppressed = new Set(db.suppressionList.map((item) => item.email));
  const unsuppressedContacts = db.contacts.filter((contact) => !suppressed.has(contact.email));
  const segment = request.body.segment || "";
  const segmentContacts = unsuppressedContacts.filter((contact) => !segment || contact.segment === segment);
  const limit = Number(request.body.limit || 25);
  const selectedContacts = segmentContacts.slice(0, limit);

  if (!db.contacts.length) {
    return response.status(400).json({
      reason: "no_contacts",
      message: "No contacts are imported on the server yet. Go to Audience, upload/import your CSV or XLSX, then launch again.",
    });
  }
  if (!unsuppressedContacts.length) {
    return response.status(400).json({
      reason: "all_suppressed",
      message: "No eligible contacts are available. All imported contacts are suppressed or unsubscribed.",
    });
  }
  if (!segmentContacts.length) {
    return response.status(400).json({
      reason: "segment_empty",
      message: `No contacts match the selected segment${segment ? `: ${segment}` : ""}. Choose All active contacts or import contacts for this segment.`,
    });
  }
  if (!selectedContacts.length) {
    return response.status(400).json({
      reason: "send_cap_zero",
      message: "No contacts were selected because the send cap is 0. Increase the send cap and try again.",
    });
  }

  const results = [];
  const createdEvents = [];
  const failures = [];
  for (const contact of selectedContacts) {
    const token = crypto.createHash("sha256").update(`${contact.email}:${campaign.id || campaign.offer}`).digest("hex");
    try {
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
    } catch (error) {
      failures.push({ email: contact.email, message: formatDeliveryError(error) });
      if (isBlockingDeliveryError(error)) break;
    }
  }

  let persisted = true;
  try {
    await writeDb(db);
  } catch (error) {
    persisted = false;
    console.error("Activity persistence failed after automation send", error);
  }
  if (failures.length) {
    const status = results.length ? 200 : 400;
    return response.status(status).json({
      message: isBlockingDeliveryError({ message: failures[0].message })
        ? failures[0].message
        : `${failures.length} opener email${failures.length === 1 ? "" : "s"} failed. ${failures[0].message}`,
      partialFailure: results.length > 0,
      mode: providerMode(runtimeConfig),
      processed: results.length,
      results,
      events: createdEvents,
      persisted,
      failures,
    });
  }
  response.json({ mode: providerMode(runtimeConfig), processed: results.length, results, events: createdEvents, persisted });
});

app.post("/api/followups/:id/push", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = await runtimeConfigForRequest(db, request.body.mailbox, { refreshGraph: true, request, response });
  const event = db.events.find((item) => item.id === request.params.id) || request.body.event;

  if (!event) return response.status(404).json({ message: "Follow-up event not found." });
  try {
    const { result, event: createdEvent } = await sendFollowupEvent(db, event, runtimeConfig);
    await writeDb(db);
    response.json({ delivery: result, event: createdEvent });
  } catch (error) {
    response.status(400).json({ message: formatDeliveryError(error) });
  }
});

app.post("/api/followups/process", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = await runtimeConfigForRequest(db, request.body.mailbox, { refreshGraph: true, request, response });
  const due = db.events
    .filter((event) => event.type === "followup-scheduled" && event.scheduledAt && new Date(event.scheduledAt) <= new Date())
    .slice(0, Number(request.body.limit || 25));
  const processed = [];
  const failures = [];

  for (const event of due) {
    try {
      processed.push(await sendFollowupEvent(db, event, runtimeConfig));
    } catch (error) {
      failures.push({ id: event.id, contactEmail: event.contactEmail, message: formatDeliveryError(error) });
      if (isBlockingDeliveryError(error)) break;
    }
  }

  await writeDb(db);
  response.json({ processed: processed.length, failures, events: processed.map((item) => item.event) });
});

app.post("/api/test/send", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = await runtimeConfigForRequest(db, request.body.mailbox, { refreshGraph: true, request, response });
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

  const attempts = [];
  for (const contact of selectedContacts) {
    const token = crypto.createHash("sha256").update(`${contact.email}:${campaign.id || campaign.offer}:test`).digest("hex");
    try {
      const result = await sendOrSimulate({
        contact,
        email: campaign.emails[0],
        campaign,
        token,
        runtimeConfig,
      });

      attempts.push({
        result,
        event: {
          id: makeId("event"),
          type: result.mode === "sent" ? "test-sent" : "test-simulation",
          contactEmail: contact.email,
          campaignName: campaign.offer,
          subject: result.subject,
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      attempts.push({ failure: { email: contact.email, message: formatDeliveryError(error) } });
      if (isBlockingDeliveryError(error)) break;
      continue;
    }
  }

  const results = attempts.map((attempt) => attempt.result).filter(Boolean);
  const failures = attempts.map((attempt) => attempt.failure).filter(Boolean);
  const createdEvents = attempts.map((attempt) => attempt.event).filter(Boolean);
  attempts
    .map((attempt) => attempt.event)
    .filter(Boolean)
    .forEach((event) => db.events.unshift(event));

  let persisted = true;
  try {
    await writeDb(db);
  } catch (error) {
    persisted = false;
    console.error("Activity persistence failed after test send", error);
  }
  if (failures.length) {
    const status = results.length ? 200 : 400;
    return response.status(status).json({
      message: isBlockingDeliveryError({ message: failures[0].message })
        ? failures[0].message
        : `${failures.length} test email${failures.length === 1 ? "" : "s"} failed. ${failures[0].message}`,
      partialFailure: results.length > 0,
      mode: providerMode(runtimeConfig),
      processed: results.length,
      results,
      events: createdEvents,
      persisted,
      failures,
    });
  }
  response.json({ mode: providerMode(runtimeConfig), processed: results.length, results, events: createdEvents, persisted });
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

app.post("/api/inbox/sync", async (request, response) => {
  const db = await readDb();
  const runtimeConfig = await runtimeConfigForRequest(db, request.body.mailbox, { refreshGraph: true, request, response });

  if (!hasGraphConnection(runtimeConfig)) {
    return response.status(400).json({
      message: "Connect Microsoft Graph before syncing replies. IMAP reply sync has been removed.",
    });
  }

  try {
    const incoming = await fetchGraphInboxMessages(db, runtimeConfig, response);
    const replyIndex = buildReplyMatchIndex(db);
    const previousMessages = db.inboxMessages || [];
    const existingMessages = previousMessages.filter((message) => {
      if (message.source !== "graph") return true;
      return Boolean(matchCampaignReply(message, replyIndex));
    });
    const byId = new Map(existingMessages.map((message) => [message.id, message]));
    incoming.forEach((message) => byId.set(message.id, { ...byId.get(message.id), ...message }));
    db.inboxMessages = [...byId.values()].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)).slice(0, 200);
    await writeDb(db);
    response.json({
      synced: incoming.length,
      messages: db.inboxMessages,
      filteredOut: Math.max(0, previousMessages.length - existingMessages.length),
    });
  } catch (error) {
    response.status(400).json({ message: formatInboxError(error) });
  }
});

app.post("/api/inbox/:id/reply", async (request, response) => {
  const db = await readDb();
  const message = db.inboxMessages?.find((item) => item.id === request.params.id) || request.body.message;
  if (!message) return response.status(404).json({ message: "Inbox message not found." });

  const runtimeConfig = await runtimeConfigForRequest(db, request.body.mailbox, { refreshGraph: true, request, response });
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
  if (!db.inboxMessages?.some((item) => item.id === message.id)) {
    db.inboxMessages = [message, ...(db.inboxMessages || [])].slice(0, 200);
  }
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
    console.log("Provider mode: Microsoft Graph mailbox");
  });
}

export default app;
