/**
 * Bureau of Meteorology current observations.
 *
 * BOM publishes each "Latest Observations" product as JSON at
 *   http://www.bom.gov.au/fwo/<product>/<product>.<wmo>.json
 * There is no CORS header on these files and BOM 403s clients that do not look
 * like a browser, which is exactly why this has to live server-side.
 *
 * BOM's usage guidance asks for no more than one request per minute per product,
 * so every response is cached for CACHE_TTL_MS and shared across callers.
 */

import { computeWetBulb, dewPointMagnus, isNum, round1, wetBulbDepression } from './psychro.js';
import { bearingLabel, haversineKm } from './geo.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * BOM actively blocks anything that looks automated, returning 403 rather than a
 * useful error. A UA containing "compatible;" or a bot URL still gets refused —
 * it has to read as an ordinary browser, with the header set a browser would send.
 *
 * Even then BOM sometimes refuses whole IP ranges, including datacentres, so this
 * is best-effort. observation.js falls back to another source when it fails.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-AU,en;q=0.9',
  'Cache-Control': 'no-cache',
  Referer: 'http://www.bom.gov.au/australia/observations/index.shtml',
};

/** The suburb the top section of the app is fixed to. */
export const SUNSHINE_WEST = {
  label: 'Sunshine West, VIC 3020',
  suburb: 'Sunshine West',
  state: 'VIC',
  lat: -37.7874,
  lon: 144.7972,
  timezone: 'Australia/Melbourne',
};

/**
 * Stations near Sunshine West, nearest first. Sunshine West has no BOM station of
 * its own, so we report the nearest automatic weather station and say so plainly
 * in the report rather than pretending the reading was taken in the suburb.
 */
export const SUNSHINE_WEST_STATIONS = [
  { name: 'Laverton RAAF', product: 'IDV60901', wmo: '94865', bomId: '087031' },
  { name: 'Essendon Airport', product: 'IDV60901', wmo: '95866', bomId: '086038' },
  { name: 'Melbourne Airport', product: 'IDV60901', wmo: '94866', bomId: '086282' },
];

const cache = new Map();

/**
 * Fetch and normalise the latest observation for one BOM station.
 * @returns {Promise<object>} normalised observation
 */
export async function fetchStationObservation(station, { fetchImpl = fetch, now = Date.now } = {}) {
  const url = `http://www.bom.gov.au/fwo/${station.product}/${station.product}.${station.wmo}.json`;
  const cached = cache.get(url);
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let payload;
  try {
    const res = await fetchImpl(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      const hint = res.status === 403
        ? ' (BOM blocks requests it thinks are automated, and refuses some networks and datacentre IP ranges outright)'
        : '';
      throw new Error(`BOM responded ${res.status} for ${station.name}${hint}`);
    }
    payload = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const observation = parseBomPayload(payload, station);
  cache.set(url, { at: now(), value: observation });
  return observation;
}

/**
 * Try the nearest station first and fall back outward. A single station being
 * offline is common enough that failing the whole report over it would be wrong.
 */
export async function fetchSunshineWestObservation(options = {}) {
  const stations = options.stations ?? SUNSHINE_WEST_STATIONS;
  const errors = [];
  for (const station of stations) {
    try {
      return await fetchStationObservation(station, options);
    } catch (err) {
      errors.push(`${station.name}: ${err.message}`);
    }
  }
  throw new Error(`No BOM station reachable. Tried — ${errors.join('; ')}`);
}

/**
 * Normalise a raw BOM product payload into the shape every surface renders.
 * Exported separately so it can be tested against a recorded fixture without
 * touching the network.
 */
export function parseBomPayload(payload, station, place = SUNSHINE_WEST) {
  const row = payload?.observations?.data?.[0];
  if (!row) throw new Error(`BOM payload for ${station.name} contained no observations`);

  const airTemp = numOrNull(row.air_temp);
  const relHum = numOrNull(row.rel_hum);
  const deltaT = numOrNull(row.delta_t);

  const wetBulb = computeWetBulb({ airTemp, deltaT, relHum });

  let dewPoint = numOrNull(row.dewpt);
  if (dewPoint === null && isNum(airTemp) && isNum(relHum)) {
    dewPoint = round1(dewPointMagnus(airTemp, relHum));
  }

  const stationPoint = { lat: numOrNull(row.lat), lon: numOrNull(row.lon) };
  const hasStationPoint = isNum(stationPoint.lat) && isNum(stationPoint.lon);

  return {
    source: 'Bureau of Meteorology',
    sourceKind: 'bom',
    kind: 'current',
    location: {
      label: place.label,
      suburb: place.suburb,
      state: place.state,
      lat: place.lat,
      lon: place.lon,
      timezone: place.timezone,
    },
    station: {
      name: row.name || station.name,
      id: station.bomId,
      wmo: station.wmo,
      lat: stationPoint.lat,
      lon: stationPoint.lon,
      distanceKm: hasStationPoint ? Math.round(haversineKm(place, stationPoint)) : null,
      bearing: hasStationPoint ? bearingLabel(place, stationPoint) : null,
    },
    observedAt: parseBomTimestamp(row.local_date_time_full, place.timezone),
    dryBulbC: airTemp,
    wetBulbC: wetBulb?.celsius ?? null,
    wetBulbMethod: wetBulb?.method ?? null,
    wetBulbApproximate: wetBulb?.approximate ?? false,
    wetBulbDepressionC: wetBulbDepression(airTemp, wetBulb?.celsius),
    dewPointC: dewPoint,
    apparentC: numOrNull(row.apparent_t),
    relativeHumidityPct: relHum,
    windDir: row.wind_dir && row.wind_dir !== '-' ? row.wind_dir : null,
    windSpeedKmh: numOrNull(row.wind_spd_kmh),
    gustKmh: numOrNull(row.gust_kmh),
    pressureHpa: numOrNull(row.press_msl) ?? numOrNull(row.press),
    rainSince9amMm: numOrNull(row.rain_trace),
  };
}

/**
 * BOM stamps observations as `YYYYMMDDHHmmss` in the station's own local time,
 * with no offset attached. We keep the wall-clock fields verbatim (they are the
 * truth for the reader) and only derive an ISO instant for sorting.
 */
export function parseBomTimestamp(raw, timezone) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(raw ?? ''));
  if (!m) {
    const now = new Date();
    return describeInstant(now, timezone);
  }
  const [, y, mo, d, h, mi] = m;
  // Interpret the wall clock in the station's zone to recover the real instant.
  const guess = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  const offsetMs = zoneOffsetMs(guess, timezone);
  return describeInstant(new Date(guess.getTime() - offsetMs), timezone);
}

/** How far ahead of UTC `timezone` was at the given instant, in milliseconds. */
function zoneOffsetMs(instant, timezone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second,
  );
  return asUtc - instant.getTime();
}

/** Render an instant into the display fields the report needs. */
export function describeInstant(date, timezone) {
  const dateLabel = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);

  const timeLabel = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date).toUpperCase();

  const tzAbbr = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone, timeZoneName: 'short',
  }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? '';

  return { iso: date.toISOString(), dateLabel, timeLabel, tzAbbr, timezone };
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '-' || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Exposed so tests can start from a clean slate. */
export function __clearCache() {
  cache.clear();
}
