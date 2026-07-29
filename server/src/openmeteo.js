/**
 * Open-Meteo — used by the chat agent for any Australian suburb and any date.
 *
 * BOM has no public API that covers arbitrary suburbs or arbitrary past/future
 * dates, so the agent section uses Open-Meteo: no API key, worldwide coverage,
 * archive back to 1940 and forecasts ~16 days out. Reports always name their
 * source so an Open-Meteo report is never mistaken for a BOM observation.
 */

import { computeWetBulb, dewPointMagnus, isNum, round1, wetBulbDepression } from './psychro.js';
import { degreesToCompass } from './geo.js';
import { describeInstant } from './bom.js';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const REQUEST_TIMEOUT_MS = 15000;

const HOURLY_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'apparent_temperature',
  'wet_bulb_temperature_2m',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'precipitation',
];

/** The archive API lags real time by roughly five days; before that, use forecast+past_days. */
const ARCHIVE_LAG_DAYS = 6;

/**
 * Resolve an Australian place name to coordinates.
 * @returns {Promise<Array<{label,suburb,state,lat,lon,timezone}>>} best matches first
 */
export async function geocodeAustralianPlace(name, { fetchImpl = fetch, count = 5 } = {}) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=${count}&country=AU&language=en&format=json`;
  const data = await getJson(url, fetchImpl);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((r) => r.country_code === 'AU')
    .map((r) => ({
      label: [r.name, r.admin1, r.postcodes?.[0]].filter(Boolean).join(', '),
      suburb: r.name,
      state: stateAbbr(r.admin1),
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone || 'Australia/Sydney',
    }));
}

/**
 * Weather for a place at a moment in time.
 *
 * @param {object} place    from geocodeAustralianPlace
 * @param {Date|null} when  target instant; null/omitted means "now"
 */
export async function fetchWeatherAt(place, when, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const current = now();
  const target = when instanceof Date && !Number.isNaN(when.getTime()) ? when : current;

  const ageDays = (current.getTime() - target.getTime()) / 86400000;
  const useArchive = ageDays > ARCHIVE_LAG_DAYS;
  const day = ymdInZone(target, place.timezone);

  const base = useArchive ? ARCHIVE_URL : FORECAST_URL;
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    hourly: HOURLY_VARS.join(','),
    timezone: place.timezone,
    start_date: day,
    end_date: day,
    wind_speed_unit: 'kmh',
  });

  let data;
  try {
    data = await getJson(`${base}?${params}`, fetchImpl);
  } catch (err) {
    // The forecast endpoint refuses start_dates outside its window; if the target
    // turned out to be just past the boundary, the archive is the right home for it.
    if (!useArchive && ageDays > 0) {
      data = await getJson(`${ARCHIVE_URL}?${params}`, fetchImpl);
    } else {
      throw err;
    }
  }

  return normaliseOpenMeteo(data, place, target, {
    kind: classifyKind(target, current),
  });
}

/** Turn an Open-Meteo hourly block into the shared observation shape. */
export function normaliseOpenMeteo(data, place, target, { kind } = {}) {
  const hourly = data?.hourly;
  const times = hourly?.time;
  if (!Array.isArray(times) || times.length === 0) {
    throw new Error(`No data available for ${place.label} at that time`);
  }

  const idx = nearestHourIndex(times, target, place.timezone);
  const at = (key) => {
    const arr = hourly[key];
    const v = Array.isArray(arr) ? arr[idx] : null;
    return isNum(v) ? v : null;
  };

  const dryBulb = at('temperature_2m');
  const relHum = at('relative_humidity_2m');

  // Open-Meteo usually returns wet_bulb_temperature_2m directly; if the variable
  // is unavailable for this endpoint or model, fall back to computing it.
  let wetBulbC = at('wet_bulb_temperature_2m');
  let wetBulbMethod = 'Open-Meteo wet_bulb_temperature_2m';
  let wetBulbApproximate = false;
  if (wetBulbC === null) {
    const computed = computeWetBulb({ airTemp: dryBulb, relHum });
    wetBulbC = computed?.celsius ?? null;
    wetBulbMethod = computed?.method ?? null;
    wetBulbApproximate = computed?.approximate ?? false;
  } else {
    wetBulbC = round1(wetBulbC);
  }

  let dewPointC = at('dew_point_2m');
  if (dewPointC === null && isNum(dryBulb) && isNum(relHum)) {
    dewPointC = round1(dewPointMagnus(dryBulb, relHum));
  }

  const windDeg = at('wind_direction_10m');
  const instant = instantFromLocalIso(times[idx], place.timezone);

  return {
    source: 'Open-Meteo',
    sourceKind: 'open-meteo',
    kind: kind ?? 'current',
    location: {
      label: place.label,
      suburb: place.suburb,
      state: place.state,
      lat: place.lat,
      lon: place.lon,
      timezone: place.timezone,
    },
    station: null,
    observedAt: describeInstant(instant, place.timezone),
    dryBulbC: round1OrNull(dryBulb),
    wetBulbC,
    wetBulbMethod,
    wetBulbApproximate,
    wetBulbDepressionC: wetBulbDepression(dryBulb, wetBulbC),
    dewPointC: round1OrNull(dewPointC),
    apparentC: round1OrNull(at('apparent_temperature')),
    relativeHumidityPct: relHum === null ? null : Math.round(relHum),
    windDir: degreesToCompass(windDeg),
    windSpeedKmh: round1OrNull(at('wind_speed_10m')),
    gustKmh: null,
    pressureHpa: round1OrNull(at('pressure_msl')),
    rainSince9amMm: round1OrNull(at('precipitation')),
  };
}

// ---------------------------------------------------------------- helpers

function classifyKind(target, current) {
  const deltaMs = target.getTime() - current.getTime();
  if (Math.abs(deltaMs) <= 60 * 60 * 1000) return 'current';
  return deltaMs > 0 ? 'forecast' : 'historical';
}

/** Index of the hourly slot closest to `target`. Open-Meteo times are zone-local ISO. */
export function nearestHourIndex(times, target, timezone) {
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i += 1) {
    const delta = Math.abs(instantFromLocalIso(times[i], timezone).getTime() - target.getTime());
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

/** Interpret a zone-local `YYYY-MM-DDTHH:mm` string as a real instant. */
function instantFromLocalIso(local, timezone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(local ?? ''));
  if (!m) return new Date(NaN);
  const [, y, mo, d, h, mi] = m;
  const guess = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(guess).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second,
  );
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

/** `YYYY-MM-DD` for an instant, as seen in the given zone. */
export function ymdInZone(date, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const STATES = {
  Victoria: 'VIC', 'New South Wales': 'NSW', Queensland: 'QLD',
  'South Australia': 'SA', 'Western Australia': 'WA', Tasmania: 'TAS',
  'Northern Territory': 'NT', 'Australian Capital Territory': 'ACT',
};

function stateAbbr(admin1) {
  return STATES[admin1] ?? admin1 ?? null;
}

async function getJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`Weather lookup failed (${res.status})`);
    const data = await res.json();
    if (data?.error) throw new Error(data.reason || 'Weather lookup failed');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function round1OrNull(v) {
  return isNum(v) ? round1(v) : null;
}
