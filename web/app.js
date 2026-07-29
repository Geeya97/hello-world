/**
 * Current Weather App — browser front end.
 *
 * Talks to the API in ../server. By default that is the same origin (the server
 * serves this directory statically), but you can point it elsewhere with
 * ?api=https://host or by setting window.WEATHER_API_BASE before this loads.
 */

import { ALLOWED_DOMAIN, REJECTION_MESSAGE, checkRecipient } from './recipients.js';

const API = resolveApiBase();

const $ = (id) => document.getElementById(id);

const els = {
  statusDot: document.querySelector('#status .dot'),
  statusText: $('status-text'),
  startBtn: $('start-btn'),
  liveLoading: $('live-loading'),
  readings: $('readings'),
  provenance: $('provenance'),
  preview: $('preview'),
  previewText: $('preview-text'),
  modal: $('dispatch-modal'),
  form: $('dispatch-form'),
  emailInput: $('email-input'),
  emailError: $('email-error'),
  sentList: $('sent-list'),
  sendBtn: $('send-btn'),
  breakBtn: $('break-btn'),
  chatLog: $('chat-log'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  chatSend: $('chat-send'),
  suggestions: $('suggestions'),
  toasts: $('toasts'),
};

/** Everything sent in the current Start…"Give me a Break" round. */
let round = [];
/** Conversation history handed to the agent each turn. */
const history = [];

// ═══════════════════════════════════════════════ top section: live readings

async function loadCurrent() {
  try {
    const data = await api('/api/current');
    renderReadings(data.observation);
    els.previewText.textContent = data.report.text;
    els.preview.hidden = false;
    setStatus('ok', `${data.observation.station?.name ?? 'BOM'} · ${data.observation.observedAt.timeLabel}`);
  } catch (err) {
    els.liveLoading.textContent = `Could not reach the Bureau just now — ${err.message}`;
    setStatus('bad', 'Observation unavailable');
  }
}

function renderReadings(obs) {
  const t = (v, unit, dp = 1) =>
    v === null || v === undefined ? '—' : `${Number(v).toFixed(dp)}${unit}`;

  $('r-dry').textContent = t(obs.dryBulbC, '°C');
  $('r-wet').textContent = t(obs.wetBulbC, '°C');
  $('r-rh').textContent = t(obs.relativeHumidityPct, '%', 0);
  $('r-dew').textContent = t(obs.dewPointC, '°C');
  $('r-wind').textContent =
    obs.windSpeedKmh === null ? '—' : `${obs.windDir ?? ''} ${Math.round(obs.windSpeedKmh)}`.trim() + ' km/h';
  $('r-press').textContent = t(obs.pressureHpa, ' hPa');

  const bits = [`${obs.observedAt.dateLabel}, ${obs.observedAt.timeLabel} ${obs.observedAt.tzAbbr}`.trim()];
  if (obs.station) {
    bits.push(`Observed at ${obs.station.name}, ${obs.station.distanceKm} km ${obs.station.bearing} of Sunshine West`);
  }
  if (obs.wetBulbMethod) bits.push(`Wet bulb via ${obs.wetBulbMethod}`);
  bits.push(`Source: ${obs.source}`);
  els.provenance.textContent = bits.join(' · ');

  els.liveLoading.hidden = true;
  els.readings.hidden = false;
}

// ══════════════════════════════════════════════════ top section: the loop

els.startBtn.addEventListener('click', () => {
  round = [];
  els.sentList.replaceChildren();
  clearError();
  els.emailInput.value = '';
  els.modal.showModal();
  els.emailInput.focus();
});

// The form submits on Enter as well as the Send button, and neither should end
// the loop — only "Give me a Break" does that.
els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void dispatchOne();
});

els.breakBtn.addEventListener('click', () => endRound());

// Esc is the same gesture as "Give me a Break", so treat it identically.
els.modal.addEventListener('cancel', (event) => {
  event.preventDefault();
  endRound();
});

els.emailInput.addEventListener('input', clearError);

async function dispatchOne() {
  const raw = els.emailInput.value;

  // Checked here for instant feedback; the server checks again before sending.
  const check = checkRecipient(raw);
  if (!check.ok) {
    showError(check.error);
    return;
  }

  setBusy(true);
  const row = addPendingRow(check.email);

  try {
    const result = await api('/api/send', {
      method: 'POST',
      body: JSON.stringify({ email: check.email }),
    });

    if (result.mode === 'compose' && result.composeUrl) {
      // Compose mode: hand the pre-filled draft to Gmail and let the human send it.
      window.open(result.composeUrl, '_blank', 'noopener');
      markRow(row, `${result.to} — draft opened in Gmail`);
      toast('good', `Draft ready for ${result.to}. Press Send in Gmail.`);
    } else {
      markRow(row, `${result.to} — sent`);
      toast('good', `Report sent to ${result.to}.`);
    }

    round.push(result.to);
    els.emailInput.value = '';
    clearError();
  } catch (err) {
    row.remove();
    // A server-side rejection of the domain belongs on the field, not in a toast.
    if (err.message === REJECTION_MESSAGE) showError(err.message);
    else toast('bad', err.message);
  } finally {
    setBusy(false);
    els.emailInput.focus();
  }
}

function endRound() {
  els.modal.close();
  if (round.length === 0) {
    toast('', 'No reports sent this round.');
  } else {
    const names = round.map((e) => e.split('@')[0]).join(', ');
    toast('good', `Break time. ${round.length} report${round.length === 1 ? '' : 's'} sent — ${names}.`);
  }
  round = [];
  els.startBtn.focus();
}

function showError(message) {
  els.emailError.textContent = message;
  els.emailError.hidden = false;
  els.emailInput.classList.add('invalid');
  els.emailInput.setAttribute('aria-invalid', 'true');
  els.emailInput.select();
}

function clearError() {
  els.emailError.hidden = true;
  els.emailError.textContent = '';
  els.emailInput.classList.remove('invalid');
  els.emailInput.removeAttribute('aria-invalid');
}

function setBusy(busy) {
  els.sendBtn.disabled = busy;
  els.sendBtn.textContent = busy ? 'Sending…' : 'Send';
}

function addPendingRow(email) {
  const li = document.createElement('li');
  li.className = 'pending';
  li.textContent = `${email} — preparing…`;
  els.sentList.append(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

function markRow(li, text) {
  li.classList.remove('pending');
  li.textContent = text;
}

// ═══════════════════════════════════════════════════ bottom section: agent

els.chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void sendChat(els.chatInput.value);
});

// Enter sends, Shift+Enter makes a new line.
els.chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    els.chatForm.requestSubmit();
  }
});

els.chatInput.addEventListener('input', () => {
  els.chatInput.style.height = 'auto';
  els.chatInput.style.height = `${Math.min(els.chatInput.scrollHeight, 160)}px`;
});

els.suggestions.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) void sendChat(chip.textContent);
});

async function sendChat(text) {
  const message = text.trim();
  if (!message) return;

  els.suggestions.hidden = true;
  addBubble('user', message);
  history.push({ role: 'user', content: message });

  els.chatInput.value = '';
  els.chatInput.style.height = 'auto';
  els.chatSend.disabled = true;

  const thinking = addThinking();

  try {
    const result = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: history }),
    });

    thinking.remove();
    addBubble('agent', result.reply);
    history.push({ role: 'assistant', content: result.reply });

    // If the agent sent something in compose mode, open the draft for the user.
    for (const action of result.actions ?? []) {
      if (action.type === 'send' && action.mode === 'compose' && action.composeUrl) {
        window.open(action.composeUrl, '_blank', 'noopener');
        toast('good', `Draft ready for ${action.to}. Press Send in Gmail.`);
      } else if (action.type === 'send' && action.delivered) {
        toast('good', `Report sent to ${action.to}.`);
      }
    }
  } catch (err) {
    thinking.remove();
    addBubble('error', err.message);
  } finally {
    els.chatSend.disabled = false;
    els.chatInput.focus();
  }
}

function addBubble(kind, text) {
  const msg = document.createElement('div');
  msg.className = `msg ${kind}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // Render the report block as preformatted text; everything else as paragraphs.
  // textContent throughout — model output is never injected as markup.
  for (const chunk of splitReportBlocks(text)) {
    if (chunk.type === 'report') {
      const pre = document.createElement('pre');
      pre.textContent = chunk.text;
      bubble.append(pre);
    } else {
      for (const para of chunk.text.split(/\n{2,}/)) {
        if (!para.trim()) continue;
        const p = document.createElement('p');
        p.textContent = para.trim();
        bubble.append(p);
      }
    }
  }

  msg.append(bubble);
  els.chatLog.append(msg);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  return msg;
}

/** Pull box-drawn report blocks out so they keep their fixed-width layout. */
function splitReportBlocks(text) {
  const chunks = [];
  const lines = String(text ?? '').split('\n');
  let buffer = [];
  let inReport = false;

  const flush = () => {
    if (buffer.length) chunks.push({ type: inReport ? 'report' : 'prose', text: buffer.join('\n') });
    buffer = [];
  };

  for (const line of lines) {
    const looksLikeReport = /[╔╚║─═]|^\s{3,}\S+ \.{3,}/.test(line);
    if (looksLikeReport !== inReport) {
      flush();
      inReport = looksLikeReport;
    }
    buffer.push(line);
  }
  flush();
  return chunks.filter((c) => c.text.trim());
}

function addThinking() {
  const msg = document.createElement('div');
  msg.className = 'msg agent';
  msg.innerHTML = '<div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div>';
  els.chatLog.append(msg);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  return msg;
}

// ═════════════════════════════════════════════════════════════ plumbing

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // Fall through to a status-based message below.
  }

  if (!res.ok) throw new Error(payload?.error ?? `Request failed (${res.status})`);
  return payload;
}

function setStatus(state, text) {
  els.statusDot.dataset.state = state;
  els.statusText.textContent = text;
}

function toast(kind, message) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`.trim();
  el.textContent = message;
  els.toasts.append(el);
  setTimeout(() => el.remove(), 5200);
}

function resolveApiBase() {
  const fromQuery = new URLSearchParams(location.search).get('api');
  const base = fromQuery ?? window.WEATHER_API_BASE ?? '';
  return base.replace(/\/$/, '');
}

// ═════════════════════════════════════════════════════════════ start up

els.emailInput.placeholder = `name@${ALLOWED_DOMAIN}`;

api('/api/health')
  .then((health) => {
    if (!health.chatConfigured) {
      $('agent-pill').textContent = 'Chat needs an API key';
      $('agent-pill').style.color = 'var(--warm)';
    }
  })
  .catch(() => { /* /api/current below reports connectivity problems already. */ });

void loadCurrent();
