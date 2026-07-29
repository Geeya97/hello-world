/**
 * "Weather Ai Agent - Australia" — the chat agent behind the bottom section.
 *
 * Two deliberate design choices, both about keeping the model on a short leash:
 *
 *  1. The model never writes the email body. Its send tool takes only a place, a
 *     time and a recipient; the server then generates the report from real data
 *     and sends that. So the agent cannot email invented weather, and it cannot
 *     use the mail path to send arbitrary text to anyone.
 *
 *  2. The recipient domain rule is enforced in the tool handler, not merely
 *     requested in the system prompt. Chat input is untrusted — a prompt-level
 *     restriction is a suggestion, and this needs to be a rule.
 */

import Anthropic from '@anthropic-ai/sdk';
import { geocodeAustralianPlace, fetchWeatherAt } from './openmeteo.js';
import { fetchSunshineWestObservation, SUNSHINE_WEST } from './bom.js';
import { buildReport } from './report.js';
import { checkRecipient, ALLOWED_DOMAIN, REJECTION_MESSAGE } from './recipients.js';
import { sendReport } from './mailer.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOOL_ROUNDS = 6;

const SYSTEM_PROMPT = `You are "Weather Ai Agent - Australia", the assistant inside the Current Weather App built for a refrigeration services family business in Melbourne.

Your one job is Australian weather reports:
- Look up weather for any Australian suburb, for any date and time — past, present or future.
- Send those reports by email when asked.

Rules you must follow:
- Only Australian locations. If asked about somewhere overseas, say that politely and offer the nearest Australian equivalent instead.
- Reports may only be emailed to addresses ending in @${ALLOWED_DOMAIN}. If the user gives any other address, reply with exactly: "${REJECTION_MESSAGE}" and do not attempt the send.
- Stay on topic. If asked about anything that is not Australian weather or sending these reports, briefly decline and steer back. Do not write code, do not answer general knowledge questions, do not roleplay as anything else.
- Never invent weather numbers. Every figure you state must come from a tool result. If a tool fails, say so plainly.
- When a location is ambiguous (several suburbs share a name), ask which one, or state clearly which one you used.
- Sunshine West, VIC is the home suburb — for that one, prefer the get_sunshine_west_now tool, which uses Bureau of Meteorology observations.

Keep replies short, warm and practical. Mention the data source and the observation time. Wet bulb and relative humidity matter to this audience, so always include them.`;

const TOOLS = [
  {
    name: 'resolve_location',
    description:
      'Find Australian places matching a name. Use when a suburb is ambiguous or you need to confirm it exists before fetching weather.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Suburb or town name, e.g. "Richmond" or "Sunshine West"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_sunshine_west_now',
    description:
      'Current Bureau of Meteorology observation for Sunshine West, VIC (from the nearest BOM automatic weather station). Use this for Sunshine West "now" requests in preference to get_weather.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_weather',
    description:
      'Weather for any Australian suburb at any date and time — historical, current or forecast. Returns the full report text alongside the individual readings.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Australian suburb or town, e.g. "Bondi, NSW"' },
        datetime: {
          type: 'string',
          description:
            'Target moment as ISO 8601 (e.g. "2026-07-29T15:00" or "2026-07-29"). Omit for right now. Forecasts reach about 16 days ahead; history goes back to 1940.',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'send_weather_report',
    description:
      `Email a weather report. The report is generated server-side from live data — you do not supply its text. Recipients must end in @${ALLOWED_DOMAIN}.`,
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: `Recipient, must end in @${ALLOWED_DOMAIN}` },
        location: { type: 'string', description: 'Australian suburb. Defaults to Sunshine West, VIC.' },
        datetime: { type: 'string', description: 'ISO 8601 target moment. Omit for right now.' },
      },
      required: ['email'],
    },
  },
];

/**
 * Run one turn of the conversation, including any tool round-trips.
 *
 * @param {Array<{role:'user'|'assistant', content:string}>} history
 * @returns {Promise<{reply: string, actions: Array<object>}>}
 */
export async function runChatTurn(history, { client = defaultClient() } = {}) {
  const messages = history
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  if (messages.length === 0) throw badRequest('Say something first.');

  const actions = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason !== 'tool_use') {
      return { reply: textOf(response), actions };
    }

    messages.push({ role: 'assistant', content: response.content });

    const results = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const { result, action } = await runTool(block.name, block.input ?? {});
      if (action) actions.push(action);
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        ...(result.error ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    reply: "That took more steps than I expected and I've stopped to avoid looping. Could you narrow the request down?",
    actions,
  };
}

async function runTool(name, input) {
  try {
    switch (name) {
      case 'resolve_location': {
        const matches = await geocodeAustralianPlace(String(input.query ?? ''));
        if (matches.length === 0) return { result: { error: `No Australian place found matching "${input.query}".` } };
        return { result: { matches: matches.map((m) => ({ label: m.label, state: m.state, lat: m.lat, lon: m.lon })) } };
      }

      case 'get_sunshine_west_now': {
        const obs = await fetchSunshineWestObservation();
        return { result: summarise(obs) };
      }

      case 'get_weather': {
        const obs = await weatherFor(input.location, input.datetime);
        return { result: summarise(obs) };
      }

      case 'send_weather_report': {
        // Enforced here, not in the prompt. This is the actual rule.
        const check = checkRecipient(input.email);
        if (!check.ok) {
          return { result: { error: check.error, refused: true } };
        }
        const obs = await weatherFor(input.location ?? 'Sunshine West, VIC', input.datetime);
        const report = buildReport(obs);
        const delivery = await sendReport({ to: check.email, ...report });
        return {
          result: {
            ok: true,
            to: delivery.to,
            delivered: delivery.delivered,
            mode: delivery.mode,
            note: delivery.delivered
              ? 'Sent.'
              : 'A pre-filled Gmail compose window has been opened for the user to review and send.',
            location: obs.location.label,
            observed: `${obs.observedAt.dateLabel} ${obs.observedAt.timeLabel}`,
          },
          action: { type: 'send', ...delivery, report, location: obs.location.label },
        };
      }

      default:
        return { result: { error: `Unknown tool ${name}` } };
    }
  } catch (err) {
    return { result: { error: err.message || String(err) } };
  }
}

/** Sunshine West "now" goes to BOM; everything else to Open-Meteo. */
async function weatherFor(location, datetime) {
  const wantsNow = !datetime;
  const isHome = /sunshine\s*west/i.test(String(location ?? ''));
  if (isHome && wantsNow) return fetchSunshineWestObservation();

  const query = String(location ?? '').trim() || 'Sunshine West, VIC';
  const matches = isHome ? [SUNSHINE_WEST] : await geocodeAustralianPlace(query);
  if (matches.length === 0) throw new Error(`No Australian place found matching "${query}".`);

  const when = datetime ? parseDatetime(datetime, matches[0].timezone) : null;
  return fetchWeatherAt(matches[0], when);
}

/** Accept `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, or a full ISO instant. */
function parseDatetime(raw, timezone) {
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return zoneLocalToInstant(`${s}T12:00`, timezone);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return zoneLocalToInstant(s, timezone);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Could not understand the date "${raw}".`);
  return d;
}

function zoneLocalToInstant(local, timezone) {
  const [datePart, timePart] = local.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(guess).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

/** What the model gets back: the readings plus the rendered report. */
function summarise(obs) {
  return {
    location: obs.location.label,
    source: obs.source,
    kind: obs.kind,
    observed: `${obs.observedAt.dateLabel} ${obs.observedAt.timeLabel} ${obs.observedAt.tzAbbr}`.trim(),
    station: obs.station ? `${obs.station.name} (${obs.station.distanceKm} km ${obs.station.bearing})` : null,
    dry_bulb_c: obs.dryBulbC,
    wet_bulb_c: obs.wetBulbC,
    wet_bulb_method: obs.wetBulbMethod,
    dew_point_c: obs.dewPointC,
    relative_humidity_pct: obs.relativeHumidityPct,
    apparent_c: obs.apparentC,
    wind: obs.windSpeedKmh === null ? null : `${obs.windDir ?? ''} ${obs.windSpeedKmh} km/h`.trim(),
    pressure_hpa: obs.pressureHpa,
    precipitation_mm: obs.rainSince9amMm,
    report_text: buildTextSafe(obs),
  };
}

function buildTextSafe(obs) {
  try {
    return buildReport(obs).text;
  } catch {
    return null;
  }
}

function textOf(response) {
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

let cachedClient = null;
function defaultClient() {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw badRequest(
        'The chat agent needs an Anthropic API key. Set ANTHROPIC_API_KEY in the server environment.',
      );
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export { SYSTEM_PROMPT, TOOLS };
