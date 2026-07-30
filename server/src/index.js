/**
 * Current Weather App — HTTP API.
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/current             BOM observation for Sunshine West + rendered report
 *   GET  /api/weather             any AU suburb, any date (Open-Meteo)
 *   POST /api/send                deliver a report to one allowed recipient
 *   POST /api/chat                Weather Ai Agent turn
 *
 * The web frontend in ../web is served statically from here too, so a single
 * `npm start` gives you the whole app on one origin with no CORS to think about.
 */

// Must come first: it populates process.env from .env before any module below
// captures a value at import time (mailer.js reads MAIL_MODE, demo.js DEMO_MODE).
import './env.js';

import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUNSHINE_WEST } from './bom.js';
import { geocodeAustralianPlace, fetchWeatherAt } from './openmeteo.js';
import { buildReport } from './report.js';
import { checkRecipient } from './recipients.js';
import { sendReport, MAIL_MODE, verifyTransport } from './mailer.js';
import { runChatTurn, activeProvider, chatConfigured, providerLabel } from './chat.js';
import { DEMO_MODE, currentHomeObservation } from './demo.js';
import { runPreflight } from './preflight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../../web');
const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(express.json({ limit: '256kb' }));

// CORS only where it is actually needed — a deployed Android app or a separately
// hosted frontend. ALLOWED_ORIGINS is a comma-separated list; unset means
// same-origin only, which is the right default.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

/**
 * Crude fixed-window limiter. Enough to keep an accidental loop from hammering
 * BOM (who ask for <=1 request/min per product) or burning Anthropic credit.
 */
const RATE_LIMIT = { windowMs: 60_000, max: Number(process.env.RATE_LIMIT_MAX || 60) };
const hits = new Map();
app.use('/api', (req, res, next) => {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > RATE_LIMIT.windowMs) {
    hits.set(key, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT.max) {
    return res.status(429).json({ error: 'Slow down a moment — too many requests.' });
  }
  return next();
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mailMode: MAIL_MODE,
    chatConfigured: chatConfigured(),
    chatProvider: activeProvider(),
    chatLabel: providerLabel(),
    demoMode: DEMO_MODE,
    home: SUNSHINE_WEST.label,
  });
});

/**
 * Same checks as `npm run check`, runnable against a deployed host. Excluded
 * from the rate limiter's tight budget is unnecessary — it is slow by nature and
 * nobody calls it in a loop.
 */
app.get('/api/preflight', wrap(async (req, res) => {
  const deliverTo = req.query.deliverTo ? String(req.query.deliverTo) : null;
  res.json(await runPreflight({ deliverTo }));
}));

app.get('/api/current', wrap(async (req, res) => {
  const observation = await currentHomeObservation();
  res.json({ observation, report: buildReport(observation) });
}));

app.get('/api/weather', wrap(async (req, res) => {
  const location = String(req.query.location ?? '').trim();
  if (!location) throw http(400, 'Tell me which suburb you want.');

  const matches = await geocodeAustralianPlace(location);
  if (matches.length === 0) throw http(404, `No Australian place found matching "${location}".`);

  const when = req.query.datetime ? new Date(String(req.query.datetime)) : null;
  if (when && Number.isNaN(when.getTime())) throw http(400, 'That date did not parse.');

  const observation = await fetchWeatherAt(matches[0], when);
  res.json({
    observation,
    report: buildReport(observation),
    alternatives: matches.slice(1, 4).map((m) => m.label),
  });
}));

app.post('/api/send', wrap(async (req, res) => {
  const { email, location, datetime } = req.body ?? {};

  const check = checkRecipient(email);
  if (!check.ok) throw http(400, check.error);

  const observation = await resolveObservation(location, datetime);
  const report = buildReport(observation);
  const delivery = await sendReport({ to: check.email, ...report });

  res.json({ ...delivery, report, location: observation.location.label });
}));

app.post('/api/chat', wrap(async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!messages) throw http(400, 'Expected a `messages` array.');
  if (messages.length > 40) throw http(400, 'That conversation is too long — start a fresh one.');

  const result = await runChatTurn(messages);
  res.json(result);
}));

app.use(express.static(WEB_ROOT, { extensions: ['html'] }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, req, res, next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

/** Sunshine West with no explicit time means BOM; anything else means Open-Meteo. */
async function resolveObservation(location, datetime) {
  const wantsHome = !location || /sunshine\s*west/i.test(String(location));
  if (wantsHome && !datetime) return currentHomeObservation();

  const query = String(location || 'Sunshine West, VIC');
  const matches = wantsHome ? [SUNSHINE_WEST] : await geocodeAustralianPlace(query);
  if (matches.length === 0) throw http(404, `No Australian place found matching "${query}".`);

  const when = datetime ? new Date(datetime) : null;
  if (when && Number.isNaN(when.getTime())) throw http(400, 'That date did not parse.');
  return fetchWeatherAt(matches[0], when);
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function http(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

if (process.env.NODE_ENV !== 'test') {
  // Bind all interfaces, not just loopback: hosts route external traffic to the
  // container's own address, and it lets a phone on the same WiFi reach a local run.
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Current Weather App is running.\n`);
    console.log(`  Open this in your browser:  http://localhost:${PORT}`);

    for (const address of lanAddresses()) {
      console.log(`  From another device:        http://${address}:${PORT}`);
    }

    console.log(`\n  mail mode : ${MAIL_MODE}${MAIL_MODE === 'compose' ? ' (opens a Gmail draft; set MAIL_MODE=smtp to send automatically)' : ''}`);
    console.log(
      `  chat agent: ${chatConfigured()
        ? `${activeProvider()} — ${providerLabel()}`
        : `NOT configured — set ${activeProvider() === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'}`}`,
    );
    if (DEMO_MODE) console.log('  DEMO_MODE : on — serving a recorded BOM observation, not live data');
    console.log('');

    // Prove the Gmail credentials now rather than on the first send mid-demo.
    if (MAIL_MODE === 'smtp') {
      verifyTransport()
        .then(() => console.log(`  Gmail authenticated as ${process.env.GMAIL_USER}.\n`))
        .catch((err) => {
          console.error(`\n  Gmail authentication FAILED: ${err.message}`);
          console.error('  Sending will not work. Run `npm run check` for the likely cause.\n');
        });
    }
  });
}

/** Non-loopback IPv4 addresses, so the startup banner can show a reachable URL. */
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

export default app;
