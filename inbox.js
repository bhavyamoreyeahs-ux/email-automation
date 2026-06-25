const inboxList = document.querySelector('#inboxList');
const replyPanel = document.querySelector('#replyPanel');
const inboxCount = document.querySelector('#inboxCount');
const toast = document.querySelector('#toast');
let selectedMessage = null;
let messages = [];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function renderInbox() {
  inboxList.innerHTML = '';
  inboxCount.textContent = String(messages.length);

  if (!messages.length) {
    inboxList.innerHTML = '<p class="muted">No inbound replies yet.</p>';
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
  const response = await fetch('/api/inbox');
  const data = await response.json();
  messages = data;
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

async function sendReply(message, mode) {
  const body = mode === 'manual'
    ? document.querySelector('#manualReplyDraft').value.trim()
    : document.querySelector('#autoReplyDraft').value.trim();

  if (!body) {
    showToast('Please enter a reply before sending.');
    return;
  }

  const response = await fetch(`/api/inbox/${message.id}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, mode }),
  });

  const result = await response.json();
  if (!response.ok) {
    showToast(result.message || 'Reply failed.');
    return;
  }

  showToast(`Reply sent via ${result.delivery.mode}.`);
  await loadInbox();
}

loadInbox();
