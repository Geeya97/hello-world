/**
 * Preflight — prove every external dependency works BEFORE the presentation.
 *
 * Run it as `npm run check`, or hit GET /api/preflight against a deployed host.
 *
 * The point is that each failure names the actual fix. "Something went wrong"
 * five minutes before you present is useless; "your App Password was rejected —
 * 2-Step Verification is probably off" is not.
 */

import { fetchSunshineWestObservation, __clearCache } from './bom.js';
import { geocodeAustralianPlace } from './openmeteo.js';
import { buildReport } from './report.js';
import { checkRecipient } from './recipients.js';
import { MAIL_MODE, sendReport, verifyTransport } from './mailer.js';
import { DEMO_MODE, demoObservation, currentHomeObservation } from './demo.js';
import { activeProvider } from './chat.js';
import { runGeminiTurn, DEFAULT_MODEL as DEFAULT_GEMINI_MODEL } from './llm/gemini.js';

/**
 * @typedef {object} CheckResult
 * @property {string} name
 * @property {'pass'|'fail'|'skip'} status
 * @property {string} detail   what happened
 * @property {string} [fix]    what to do about it, when it failed
 */

/**
 * Run every check. Never throws — a preflight that crashes tells you nothing.
 *
 * @param {object} options
 * @param {string|null} options.deliverTo  address to send a real test report to
 * @returns {Promise<{ ok: boolean, checks: CheckResult[] }>}
 */
export async function runPreflight({ deliverTo = process.env.PREFLIGHT_TO ?? null } = {}) {
  const checks = [];

  checks.push(await checkBom());
  checks.push(await checkOpenMeteo());
  checks.push(await checkChatAgent());
  checks.push(await checkSmtp());
  checks.push(await checkDelivery(deliverTo));

  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}

// ──────────────────────────────────────────────────────────── individual checks

async function checkBom() {
  const name = 'Bureau of Meteorology';

  if (DEMO_MODE) {
    const obs = demoObservation();
    return pass(name, `DEMO_MODE is on — serving a recorded observation (${obs.dryBulbC} °C dry bulb). Live BOM was not contacted.`);
  }

  try {
    __clearCache();
    const obs = await fetchSunshineWestObservation();

    if (obs.dryBulbC === null) {
      return fail(
        name,
        `Reached ${obs.station?.name ?? 'BOM'} but air_temp was empty.`,
        'The station is reporting partial data. Preflight will pass once it recovers; the app already falls back to Essendon and Melbourne Airport.',
      );
    }

    const wetBulbNote = obs.wetBulbC === null
      ? ' Wet bulb unavailable — neither delta_t nor humidity was present.'
      : ` Wet bulb ${obs.wetBulbC} °C via ${obs.wetBulbMethod}.`;

    return pass(
      name,
      `${obs.station?.name ?? 'BOM'} at ${obs.observedAt.timeLabel}: dry bulb ${obs.dryBulbC} °C.${wetBulbNote}`,
    );
  } catch (err) {
    return fail(
      name,
      err.message,
      'BOM blocks non-browser clients and some networks block bom.gov.au. If this is the only failure you can still demo with DEMO_MODE=1, which serves a recorded observation.',
    );
  }
}

async function checkOpenMeteo() {
  const name = 'Open-Meteo (agent lookups)';
  try {
    const matches = await geocodeAustralianPlace('Bondi');
    if (matches.length === 0) {
      return fail(name, 'Geocoder responded but found no Australian match for "Bondi".', 'Unexpected — retry; if it persists the API shape may have changed.');
    }
    return pass(name, `Resolved "Bondi" to ${matches[0].label}.`);
  } catch (err) {
    return fail(
      name,
      err.message,
      'Only the chat agent needs this. The top section (Sunshine West + email) works without it.',
    );
  }
}

/** Dispatches to whichever brain is configured. */
async function checkChatAgent() {
  return activeProvider() === 'anthropic' ? checkAnthropic() : checkGemini();
}

/**
 * The Gemini check does a real tool-calling round trip, not just a "say hello".
 * The agent's whole job depends on function calling, and a key can be valid for
 * plain generation while the chosen model is closed to new accounts — which is
 * exactly what gemini-2.5-flash does. So this exercises the real path.
 */
async function checkGemini() {
  const name = 'Gemini API (chat agent)';
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  if (!key) {
    return fail(
      name,
      'GEMINI_API_KEY is not set.',
      'Get a free key at aistudio.google.com/apikey and put it in .env (local) or the host dashboard. Without it only the chat section is unavailable — the weather and email half works regardless.',
    );
  }

  try {
    const { reply } = await runGeminiTurn({
      system: 'You are a test harness. Call the ping tool, then reply with exactly what it returned.',
      tools: [{
        name: 'ping',
        description: 'Returns a token proving tool calling works.',
        input_schema: { type: 'object', properties: {} },
      }],
      history: [{ role: 'user', content: 'Call the ping tool and tell me the token.' }],
      runTool: async () => ({ result: { token: 'PREFLIGHT-OK' } }),
      maxRounds: 3,
    });

    if (!/PREFLIGHT-OK/.test(reply)) {
      return fail(
        name,
        `${model} answered but did not complete the tool round trip. It said: "${reply.slice(0, 120)}"`,
        'Function calling is not working on this model. Set GEMINI_MODEL=gemini-flash-latest, which is verified to support it.',
      );
    }

    return pass(name, `${model} completed a tool-calling round trip. Key valid and function calling works.`);
  } catch (err) {
    // runGeminiTurn already translates the common failures into actionable text.
    const message = err.message ?? String(err);

    if (/quota/i.test(message)) {
      return fail(
        name,
        message,
        `Free-tier limits are per-minute and per-day. Wait a minute and re-run. Available models vary by key — list yours with:  curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"`,
      );
    }
    if (/not available to this API key/i.test(message)) {
      return fail(name, message, 'gemini-flash-latest is verified working — set GEMINI_MODEL to that.');
    }
    if (/rejected|not valid/i.test(message)) {
      return fail(name, message, 'Generate a fresh key at aistudio.google.com/apikey.');
    }
    return fail(name, message, 'Check network access to generativelanguage.googleapis.com.');
  }
}

async function checkAnthropic() {
  const name = 'Claude API (chat agent)';
  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) {
    return fail(
      name,
      'LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.',
      'Create a key at console.anthropic.com and add credit — an Anthropic API key is a separate paid product from a Claude.ai subscription. Or switch to Gemini, which has a free tier, by setting GEMINI_API_KEY.',
    );
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key });
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

    const response = await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    });

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return pass(name, `${model} replied "${text}". Key valid and credit available.`);
  } catch (err) {
    // These failures look identical to a user but need different fixes.
    const status = err?.status;
    if (status === 401) {
      return fail(name, 'Key rejected (401).', 'The key is wrong or has been revoked. Generate a fresh one at console.anthropic.com.');
    }
    if (status === 400 && /credit|balance/i.test(err.message ?? '')) {
      return fail(name, 'Key is valid but the account has no credit.', 'Add credit at console.anthropic.com under Billing.');
    }
    if (status === 404) {
      return fail(name, `Model "${process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'}" not available to this key.`, 'Set ANTHROPIC_MODEL to a model your account can use.');
    }
    if (status === 429) {
      return fail(name, 'Rate limited (429).', 'Wait a moment and re-run. Not a problem for a demo.');
    }
    return fail(name, err.message, 'Check network access to api.anthropic.com.');
  }
}

async function checkSmtp() {
  const name = 'Gmail sending';

  if (MAIL_MODE !== 'smtp') {
    return skip(
      name,
      `MAIL_MODE is "${MAIL_MODE}" — the app will open a pre-filled Gmail draft for you to send by hand. Nothing to authenticate.`,
    );
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return fail(
      name,
      'MAIL_MODE=smtp but GMAIL_USER or GMAIL_APP_PASSWORD is missing.',
      'Set both. The App Password is a 16-character code from myaccount.google.com/apppasswords, not your normal Gmail password.',
    );
  }

  try {
    await verifyTransport();
    return pass(name, `Authenticated with Gmail as ${process.env.GMAIL_USER}.`);
  } catch (err) {
    const message = err.message ?? String(err);

    if (/Invalid login|Username and Password not accepted|BadCredentials/i.test(message)) {
      return fail(
        name,
        'Gmail rejected the credentials.',
        'Three usual causes: you used your normal Gmail password instead of a 16-character App Password; 2-Step Verification is not switched on (App Passwords do not exist without it); or the password was pasted with spaces. Regenerate at myaccount.google.com/apppasswords.',
      );
    }
    if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ESOCKET|timeout/i.test(message)) {
      return fail(
        name,
        `Could not reach Gmail's SMTP server: ${message}`,
        'This network is blocking outbound SMTP (ports 465/587) — common on venue, campus and corporate WiFi. Either present from a different network, deploy to a host so the connection leaves a datacentre instead, or switch to MAIL_MODE=compose.',
      );
    }
    return fail(name, message, 'Re-run to confirm, then check the Gmail account for security alerts.');
  }
}

/**
 * The one check that catches a silent demo failure: Gmail accepts mail for a
 * non-existent address and bounces it minutes later, so the app reports success
 * while nothing ever arrives.
 */
async function checkDelivery(deliverTo) {
  const name = 'End-to-end delivery';

  if (!deliverTo) {
    return skip(
      name,
      'No test recipient given. Re-run with PREFLIGHT_TO=someone@refrigerationservices.com.au to send one real report and confirm it arrives.',
    );
  }

  const check = checkRecipient(deliverTo);
  if (!check.ok) {
    return fail(name, `"${deliverTo}" — ${check.error}`, 'Use an address on @refrigerationservices.com.au, the same rule the app enforces.');
  }

  try {
    const observation = await currentHomeObservation();
    const report = buildReport(observation);
    const result = await sendReport({ to: check.email, ...report });

    if (!result.delivered) {
      return skip(
        name,
        `Compose mode: a draft was prepared for ${result.to} but not sent. Set MAIL_MODE=smtp to test real delivery.`,
      );
    }

    return pass(
      name,
      `Report sent to ${result.to} (message id ${result.messageId}). Open that inbox now and confirm it arrived — Gmail accepts mail for addresses that do not exist and bounces it later.`,
    );
  } catch (err) {
    return fail(name, err.message, 'Fix the Gmail check above first; this one depends on it.');
  }
}

// ──────────────────────────────────────────────────────────────────── helpers

const pass = (name, detail) => ({ name, status: 'pass', detail });
const skip = (name, detail) => ({ name, status: 'skip', detail });
const fail = (name, detail, fix) => ({ name, status: 'fail', detail, fix });

/**
 * Render results as a readable web page.
 *
 * The JSON version is fine from a terminal, but someone opening /api/preflight in
 * a browser before a presentation should not have to read raw JSON to find out
 * whether their Gmail password works. Same data, legible.
 */
export function formatPreflightHtml({ ok, checks, note }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const mark = { pass: '✓', fail: '✕', skip: '–' };
  const colour = { pass: '#1a7f5a', fail: '#b3243c', skip: '#74869a' };

  const rows = checks.map((c) => `
    <li style="border:1px solid #dde5ec;border-left:4px solid ${colour[c.status]};border-radius:4px;padding:14px 16px;background:#fff">
      <div style="display:flex;gap:10px;align-items:baseline">
        <span style="color:${colour[c.status]};font-weight:700;font-size:17px;line-height:1.2">${mark[c.status]}</span>
        <strong style="font-size:15px">${esc(c.name)}</strong>
      </div>
      <p style="margin:8px 0 0 26px;color:#46586b;font-size:13.5px;line-height:1.6">${esc(c.detail)}</p>
      ${c.fix ? `<p style="margin:10px 0 0 26px;padding:10px 12px;background:#fdf6e7;border-radius:3px;color:#6b4f12;font-size:13px;line-height:1.6"><strong>What to do:</strong> ${esc(c.fix)}</p>` : ''}
    </li>`).join('');

  const failed = checks.filter((c) => c.status === 'fail');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Ready' : 'Not ready'} — Current Weather App preflight</title>
</head>
<body style="margin:0;padding:28px 20px 60px;background:#eef3fb;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0b1a28">
<div style="max-width:720px;margin:0 auto">
  <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#74869a">Current Weather App</p>
  <h1 style="margin:8px 0 0;font-size:26px;letter-spacing:-.02em">${ok ? 'Ready to go' : 'Not ready yet'}</h1>
  <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#46586b">
    ${ok
      ? 'Every check passed. If a real email was sent, open that mailbox now and confirm it arrived — a send being accepted is not proof it was delivered.'
      : `${failed.length} thing${failed.length === 1 ? '' : 's'} need${failed.length === 1 ? 's' : ''} fixing: <strong>${esc(failed.map((c) => c.name).join(', '))}</strong>. Each one below says what to do.`}
  </p>
  ${note ? `<p style="margin:14px 0 0;padding:12px 14px;background:#fdf6e7;border-radius:4px;font-size:13.5px;line-height:1.6;color:#6b4f12">${esc(note)}</p>` : ''}
  <ul style="list-style:none;margin:22px 0 0;padding:0;display:flex;flex-direction:column;gap:10px">${rows}</ul>
  <p style="margin:26px 0 0;font-size:12.5px;color:#74869a;line-height:1.6">
    Add <code>?deliverTo=you@refrigerationservices.com.au&amp;token=YOUR_TOKEN</code> to send one real test report.
  </p>
</div>
</body></html>`;
}

/** Render results for a terminal. Exported so tests can assert on the format. */
export function formatPreflight({ ok, checks }) {
  const mark = { pass: '  ok  ', fail: ' FAIL ', skip: ' skip ' };
  const lines = ['', 'Current Weather App — preflight', '─'.repeat(64)];

  for (const check of checks) {
    lines.push(`[${mark[check.status]}] ${check.name}`);
    lines.push(`          ${check.detail}`);
    if (check.fix) lines.push(`    fix → ${check.fix}`);
    lines.push('');
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const skipped = checks.filter((c) => c.status === 'skip');

  lines.push('─'.repeat(64));
  lines.push(
    ok
      ? `Ready. ${checks.length - skipped.length} of ${checks.length} checks passed${skipped.length ? `, ${skipped.length} skipped` : ''}.`
      : `Not ready — ${failed.length} check${failed.length === 1 ? '' : 's'} failed: ${failed.map((c) => c.name).join(', ')}.`,
  );
  lines.push('');

  return lines.join('\n');
}

// Run directly: `npm run check`
if (process.argv[1] && process.argv[1].endsWith('preflight.js')) {
  await import('./env.js');
  const deliverTo = process.argv[2] ?? process.env.PREFLIGHT_TO ?? null;
  const result = await runPreflight({ deliverTo });
  console.log(formatPreflight(result));
  process.exit(result.ok ? 0 : 1);
}
