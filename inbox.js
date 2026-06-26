const inboxList = document.querySelector('#inboxList');
const replyPanel = document.querySelector('#replyPanel');
const inboxCount = document.querySelector('#inboxCount');
const toast = document.querySelector('#toast');
const syncInboxButton = document.querySelector('#syncInboxButton');
const inboxSyncStatus = document.querySelector('#inboxSyncStatus');
const manualReplyForm = document.querySelector('#manualReplyForm');
const mailboxKey = 'emailAutomationMailbox';
const localInboxKey = 'emailAutomationInbox';
const sessionKey = 'emailAutomationSession';
let selectedMessage = null;
let messages = [];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), Math.min(5200, Math.max(2600, String(message).length * 38)));
}

function setBusy(control, busy, label = 'Working...') {
  if (!control) return;
  if (busy) {
    control.dataset.originalText = control.textContent;
    control.textContent = label;
    control.disabled = true;
    control.classList.add('is-busy');
  } else {
    control.textContent = control.dataset.originalText || control.textContent;
    control.disabled = false;
    control.classList.remove('is-busy');
    delete control.dataset.originalText;
  }
}

async function apiFetch(path, options) {
  const session = getJson(sessionKey, {});
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
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

function savedMailboxPayload() {
  const mailbox = getJson(mailboxKey, {});
  if (!mailbox.connected || !mailbox.smtpHost || !mailbox.smtpUser || !mailbox.smtpPass) return null;
  return mailbox;
}

function mergeMessages(primary = [], secondary = []) {
  const byId = new Map();
  [...primary, ...secondary].filter((message) => message?.id).forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

function saveInbox(nextMessages) {
  const merged = mergeMessages(nextMessages, getJson(localInboxKey, []));
  messages = merged.slice(0, 200);
  setJson(localInboxKey, messages);
}

function renderInbox() {
  inboxList.innerHTML = '';
  inboxCount.textContent = String(messages.length);

  if (!messages.length) {
    inboxList.innerHTML = '<div class="empty-state"><strong>No replies yet</strong><span>Sync replies with Microsoft Graph, or add a reply manually as backup.</span></div>';
    return;
  }

  messages.forEach((message) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    if (selectedMessage?.id === message.id) {
      item.classList.add('selected');
    }

    const content = document.createElement('div');
    content.className = 'activity-content';

    const title = document.createElement('strong');
    title.textContent = `${message.name || message.email} • ${message.subject}`;

    const preview = document.createElement('span');
    preview.textContent = message.preview || message.body;

    const meta = document.createElement('span');
    meta.textContent = new Date(message.receivedAt).toLocaleString();

    content.append(title, preview, meta);
    item.append(content);
    item.addEventListener('click', () => selectMessage(message));
    inboxList.append(item);
  });
}

function renderReplyPanel(message) {
  if (!message) {
    replyPanel.innerHTML = '<p class="muted">Select a message to view and respond.</p>';
    return;
  }

  replyPanel.innerHTML = '';

  const card = document.createElement('div');
  const subject = document.createElement('strong');
  const from = document.createElement('p');
  const incoming = document.createElement('div');
  const incomingContent = document.createElement('div');
  const incomingTitle = document.createElement('strong');
  const incomingBody = document.createElement('span');
  const autoLabel = document.createElement('label');
  const autoTextarea = document.createElement('textarea');
  const manualLabel = document.createElement('label');
  const manualTextarea = document.createElement('textarea');
  const actions = document.createElement('div');
  const autoButton = document.createElement('button');
  const manualButton = document.createElement('button');

  card.className = 'mail-connect-card reply-card';
  from.className = 'muted';
  incoming.className = 'activity-item incoming-message';
  incomingContent.className = 'activity-content';
  actions.className = 'mail-actions';

  subject.textContent = message.subject;
  from.textContent = `From ${message.name || message.email} - ${message.email}`;
  incomingTitle.textContent = 'Incoming message';
  incomingBody.textContent = message.body;

  autoLabel.textContent = 'Auto reply draft';
  autoTextarea.id = 'autoReplyDraft';
  autoTextarea.rows = 8;
  manualLabel.textContent = 'Manual reply';
  manualTextarea.id = 'manualReplyDraft';
  manualTextarea.rows = 8;
  manualTextarea.placeholder = 'Type or paste your own reply here';

  autoButton.className = 'primary-button';
  autoButton.id = 'sendAutoReplyButton';
  autoButton.type = 'button';
  autoButton.textContent = 'Send automated draft';
  manualButton.className = 'ghost-button compact';
  manualButton.id = 'sendManualReplyButton';
  manualButton.type = 'button';
  manualButton.textContent = 'Send manual reply';

  incomingContent.append(incomingTitle, incomingBody);
  incoming.append(incomingContent);
  autoLabel.append(autoTextarea);
  manualLabel.append(manualTextarea);
  actions.append(autoButton, manualButton);
  card.append(subject, from, incoming, autoLabel, manualLabel, actions);
  replyPanel.append(card);

  document.querySelector('#autoReplyDraft').value = `Hi ${message.name || message.email},\n\n`;

  document.querySelector('#sendAutoReplyButton').addEventListener('click', () => sendReply(message, 'auto'));
  document.querySelector('#sendManualReplyButton').addEventListener('click', () => sendReply(message, 'manual'));
}

function selectMessage(message) {
  selectedMessage = message;
  renderReplyPanel(message);
  renderInbox();
}

async function loadInbox() {
  const data = await apiFetch('/api/inbox').catch(() => []);
  saveInbox(data);
  renderInbox();
  if (selectedMessage) {
    const fresh = messages.find((item) => item.id === selectedMessage.id);
    if (fresh) {
      selectedMessage = fresh;
      renderReplyPanel(fresh);
    }
  } else if (messages[0]) {
    selectMessage(messages[0]);
  }
}

async function syncInbox() {
  const mailbox = savedMailboxPayload();
  if (!mailbox) {
    showToast('Reconnect SMTP once so Inbox can use the saved mailbox credentials.');
    if (inboxSyncStatus) inboxSyncStatus.textContent = 'Mailbox credentials are not saved in this browser yet. Reconnect Mailbox first.';
    return;
  }

  syncInboxButton.disabled = true;
  setBusy(syncInboxButton, true, 'Syncing...');
  if (inboxSyncStatus) inboxSyncStatus.textContent = 'Connecting to the mailbox...';
  try {
    const result = await apiFetch('/api/inbox/sync', {
      method: 'POST',
      body: JSON.stringify({ mailbox }),
    });
    saveInbox(result.messages || []);
    renderInbox();
    if (inboxSyncStatus) inboxSyncStatus.textContent = `Last sync completed. ${result.synced} message${result.synced === 1 ? '' : 's'} returned.`;
    showToast(`Synced ${result.synced} inbox messages.`);
  } catch (error) {
    if (inboxSyncStatus) inboxSyncStatus.textContent = `${error.message} You can add the reply manually below while the mailbox connection is being fixed.`;
    showToast(error.message);
  } finally {
    setBusy(syncInboxButton, false);
  }
}

function addManualReply(event) {
  event.preventDefault();
  const email = document.querySelector('#manualReplyEmailInput').value.trim().toLowerCase();
  const name = document.querySelector('#manualReplyNameInput').value.trim();
  const subject = document.querySelector('#manualReplySubjectInput').value.trim();
  const body = document.querySelector('#manualReplyBodyInput').value.trim();

  if (!email || !subject || !body) {
    showToast('Email, subject, and reply body are required.');
    return;
  }

  const message = {
    id: `manual_${Date.now()}_${email.replace(/[^a-z0-9]/gi, '')}`,
    name,
    email,
    subject,
    body,
    preview: body.slice(0, 180),
    receivedAt: new Date().toISOString(),
    source: 'manual',
  };

  saveInbox([message]);
  renderInbox();
  selectMessage(message);
  manualReplyForm.reset();
  if (inboxSyncStatus) inboxSyncStatus.textContent = 'Manual reply added. It now counts as a reply in Inbox and dashboard reporting.';
  showToast('Reply added to inbox.');
}

async function sendReply(message, mode) {
  const body = mode === 'manual'
    ? document.querySelector('#manualReplyDraft').value.trim()
    : document.querySelector('#autoReplyDraft').value.trim();

  if (!body) {
    showToast('Please enter a reply before sending.');
    return;
  }
  const button = mode === 'manual' ? document.querySelector('#sendManualReplyButton') : document.querySelector('#sendAutoReplyButton');
  setBusy(button, true, 'Sending...');

  try {
  const response = await fetch(`/api/inbox/${message.id}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getJson(sessionKey, {})?.token ? { Authorization: `Bearer ${getJson(sessionKey, {}).token}` } : {}),
    },
    body: JSON.stringify({ body, mode, mailbox: savedMailboxPayload(), message }),
  });

    const result = await response.json();
    if (!response.ok) {
      showToast(result.message || 'Reply failed.');
      return;
    }

    showToast(`Reply sent via ${result.delivery.mode}.`);
    await loadInbox();
  } catch (error) {
    showToast(error.message || 'Reply failed.');
  } finally {
    setBusy(button, false);
  }
}

syncInboxButton?.addEventListener('click', syncInbox);
manualReplyForm?.addEventListener('submit', addManualReply);
saveInbox(getJson(localInboxKey, []));
renderInbox();
loadInbox();
