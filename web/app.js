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
  sentPanel: $('sent-panel'),
  sentLog: $('sent-log'),
  sentCount: $('sent-count'),
  clearSent: $('clear-sent'),
  chatLog: $('chat-log'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  chatSend: $('chat-send'),
  suggestions: $('suggestions'),
  toasts: $('toasts'),
};

/** Everything sent in the current Start…"Give me a Break" round. */
let round = [];
/** Every report sent since the page loaded, across rounds and the agent. */
let sentThisSession = 0;
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

/**
 * Keep a free-tier host awake while this tab is open.
 *
 * Render's free plan sleeps an instance after ~15 minutes idle and takes 30-60
 * seconds to wake — a long silence in the middle of a presentation. A cheap ping
 * every 10 minutes avoids it, and stops when the tab is hidden so it costs
 * nothing while you're not using it.
 */
function startKeepAwake() {
  const TEN_MINUTES = 10 * 60 * 1000;
  let timer = null;

  const ping = () => {
    fetch(`${API}/api/health`, { cache: 'no-store' }).catch(() => { /* offline is fine */ });
  };

  const start = () => {
    if (timer === null) timer = setInterval(ping, TEN_MINUTES);
  };
  const stop = () => {
    if (timer !== null) { clearInterval(timer); timer = null; }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else { ping(); start(); }
  });

  start();
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

  // Say plainly when BOM was unavailable, rather than quietly showing another
  // source's numbers under a Bureau-branded heading.
  if (obs.fallbackFrom === 'bom') {
    const notice = document.createElement('p');
    notice.className = 'fallback-notice';
    notice.textContent =
      `The Bureau of Meteorology refused this connection, so these readings come from ${obs.source.replace(/ \(.*\)$/, '')} for the same location. Still live weather — every report says which source it used.`;
    els.provenance.before(notice);
  }

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
      const opened = openDraft(result.composeUrl);

      if (!opened) {
        // Blocked by the browser. Never claim it opened — give them the link.
        markRowWithDraftLink(row, `${result.to} — blocked by your browser:`, result.composeUrl);
        toast('bad', 'Your browser blocked the Gmail window. Use the "Open draft" link in the list below.');
      } else if (result.fellBackFrom === 'smtp') {
        // Automatic sending was configured but failed — say so, rather than
        // letting it look like this was the intended behaviour.
        markRowWithDraftLink(row, `${result.to} — automatic send failed, draft opened.`, result.composeUrl);
        toast('bad', result.reason ?? 'Automatic sending failed; a Gmail draft was opened instead.');
      } else {
        markRowWithDraftLink(row, `${result.to} — draft opened.`, result.composeUrl);
        toast('good', `Draft ready for ${result.to} — press Send in the Gmail tab.`);
      }
    } else {
      markRow(row, `${result.to} — sent`);
      toast('good', `Report sent to ${result.to}.`);
    }

    recordSent(result);
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

/**
 * Open a pre-filled Gmail draft, reporting whether it actually opened.
 *
 * Two traps here, both hit in practice:
 *  - `noopener` makes window.open always return null, so a blocked pop-up is
 *    indistinguishable from a successful one. The opener is severed manually
 *    instead, which is the same protection.
 *  - This runs after an await, sometimes 12 seconds after the click, so it is
 *    outside the user-gesture window and browsers block it by default. The
 *    caller must therefore always offer a clickable link as well — clicking that
 *    IS a gesture, so it always works.
 */
function openDraft(url) {
  const win = window.open(url, '_blank');
  if (!win) return false;
  try { win.opener = null; } catch { /* cross-origin after navigation; fine */ }
  return true;
}

/**
 * Log what actually went out.
 *
 * This exists for the live demo: it lets the audience see the real report that
 * was sent without needing a recipient's inbox open on screen.
 */
function recordSent(result) {
  sentThisSession += 1;
  els.sentCount.textContent = String(sentThisSession);
  els.sentPanel.hidden = false;

  const time = new Date().toLocaleTimeString('en-AU', {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });

  const details = document.createElement('details');

  const summary = document.createElement('summary');
  const to = document.createElement('span');
  to.className = 'to';
  to.textContent = result.to;
  const when = document.createElement('span');
  when.className = 'when';
  when.textContent = time;
  const how = document.createElement('span');
  how.className = `how ${result.delivered ? 'delivered' : 'draft'}`;
  how.textContent = result.delivered ? 'Delivered' : 'Needs your Send';
  summary.append(to, when, how);

  // Always reachable, whether or not the pop-up was allowed.
  if (!result.delivered && result.composeUrl) {
    const link = document.createElement('a');
    link.className = 'draft-link';
    link.href = result.composeUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open draft';
    link.addEventListener('click', (e) => e.stopPropagation());
    summary.append(link);
  }

  const pre = document.createElement('pre');
  pre.textContent = result.report?.text ?? '(report text unavailable)';

  details.append(summary, pre);
  els.sentLog.prepend(details);
}

els.clearSent.addEventListener('click', () => {
  sentThisSession = 0;
  els.sentCount.textContent = '0';
  els.sentLog.replaceChildren();
  els.sentPanel.hidden = true;
});

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

/**
 * Mark a row and attach a clickable draft link.
 *
 * The link matters even when the pop-up did open: it is the recovery path when
 * the browser blocked it, and clicking it counts as a user gesture so it is
 * never blocked itself.
 */
function markRowWithDraftLink(li, text, composeUrl) {
  li.classList.remove('pending');
  li.textContent = text;

  const link = document.createElement('a');
  link.className = 'draft-link';
  link.href = composeUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Open draft';
  li.append(link);
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
    // Either way it goes in the session log alongside the manual dispatches.
    for (const action of result.actions ?? []) {
      if (action.type !== 'send') continue;

      if (action.mode === 'compose' && action.composeUrl) {
        const opened = openDraft(action.composeUrl);
        toast(
          opened ? 'good' : 'bad',
          opened
            ? `Draft ready for ${action.to} — press Send in the Gmail tab.`
            : 'Your browser blocked the Gmail window. Use the "Open draft" link in the list below.',
        );
      } else if (action.delivered) {
        toast('good', `Report sent to ${action.to}.`);
      }

      recordSent(action);
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

/**
 * Every request is bounded. Without a timeout a stalled request — a network
 * silently swallowing SMTP, a sleeping host — leaves the button spinning forever
 * with no explanation, which is precisely what you don't want on stage.
 */
async function api(path, { timeoutMs = 45_000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        `That took longer than ${Math.round(timeoutMs / 1000)} seconds and was given up on. If the app is hosted it may have been asleep — try again.`,
      );
    }
    throw new Error('Could not reach the app. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }

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

// The badge names whichever brain the server is actually configured with, rather
// than hardcoding one — the provider is a server-side setting.
api('/api/health')
  .then((health) => {
    const pill = $('agent-pill');
    if (health.chatConfigured) {
      pill.textContent = health.chatLabel ?? 'Weather agent';
    } else {
      pill.textContent = 'Chat needs an API key';
      pill.style.color = 'var(--warm)';
    }
  })
  .catch(() => { /* /api/current below reports connectivity problems already. */ });

void loadCurrent();
startKeepAwake();
