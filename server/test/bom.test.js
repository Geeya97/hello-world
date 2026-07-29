import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseBomPayload,
  parseBomTimestamp,
  fetchSunshineWestObservation,
  SUNSHINE_WEST,
  SUNSHINE_WEST_STATIONS,
  __clearCache,
} from '../src/bom.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/bom-laverton.json', import.meta.url)), 'utf8'),
);
const LAVERTON = SUNSHINE_WEST_STATIONS[0];

test('parses the latest observation from a real BOM payload shape', () => {
  const obs = parseBomPayload(fixture, LAVERTON);

  assert.equal(obs.source, 'Bureau of Meteorology');
  assert.equal(obs.kind, 'current');
  assert.equal(obs.dryBulbC, 13.4);
  assert.equal(obs.dewPointC, 9.8);
  assert.equal(obs.relativeHumidityPct, 79);
  assert.equal(obs.apparentC, 11.0);
  assert.equal(obs.windDir, 'NW');
  assert.equal(obs.windSpeedKmh, 15);
  assert.equal(obs.gustKmh, 28);
  assert.equal(obs.pressureHpa, 1018.3);
  assert.equal(obs.rainSince9amMm, 0.2);
});

test('takes the first row, which is the most recent observation', () => {
  const obs = parseBomPayload(fixture, LAVERTON);
  assert.equal(obs.dryBulbC, 13.4, 'should not pick up the older 15:00 row');
});

test('derives wet bulb from delta_t', () => {
  const obs = parseBomPayload(fixture, LAVERTON);
  assert.equal(obs.wetBulbC, 11.2);
  assert.equal(obs.wetBulbDepressionC, 2.2);
  assert.match(obs.wetBulbMethod, /delta_t/);
});

test('reports the observing station and its distance from Sunshine West', () => {
  const obs = parseBomPayload(fixture, LAVERTON);
  assert.equal(obs.station.name, 'Laverton');
  assert.equal(obs.station.id, '087031');
  // Laverton sits roughly 13 km south-west of Sunshine West.
  assert.ok(obs.station.distanceKm > 5 && obs.station.distanceKm < 25, `got ${obs.station.distanceKm} km`);
  assert.match(obs.station.bearing, /S/);
  assert.equal(obs.location.label, SUNSHINE_WEST.label);
});

test('treats BOM sentinel values as missing rather than as data', () => {
  const payload = structuredClone(fixture);
  Object.assign(payload.observations.data[0], {
    wind_dir: '-', gust_kmh: null, rain_trace: '-', press_msl: null, press: 1011.5,
  });
  const obs = parseBomPayload(payload, LAVERTON);
  assert.equal(obs.windDir, null);
  assert.equal(obs.gustKmh, null);
  assert.equal(obs.rainSince9amMm, null);
  assert.equal(obs.pressureHpa, 1011.5, 'falls back to station pressure when MSL is absent');
});

test('falls back to Stull when BOM omits delta_t', () => {
  const payload = structuredClone(fixture);
  payload.observations.data[0].delta_t = null;
  const obs = parseBomPayload(payload, LAVERTON);
  assert.equal(obs.wetBulbC, 11.1);
  assert.match(obs.wetBulbMethod, /Stull/);
});

test('derives dew point when BOM omits it', () => {
  const payload = structuredClone(fixture);
  payload.observations.data[0].dewpt = null;
  const obs = parseBomPayload(payload, LAVERTON);
  assert.ok(Math.abs(obs.dewPointC - 9.8) < 0.5, `got ${obs.dewPointC}`);
});

test('throws a clear error on an empty payload', () => {
  assert.throws(() => parseBomPayload({ observations: { data: [] } }, LAVERTON), /no observations/i);
  assert.throws(() => parseBomPayload({}, LAVERTON), /no observations/i);
});

test('interprets BOM timestamps in Melbourne wall-clock time', () => {
  const t = parseBomTimestamp('20260729153000', 'Australia/Melbourne');
  assert.equal(t.dateLabel, 'Wednesday 29 July 2026');
  assert.equal(t.timeLabel, '3:30 PM');
  // 29 July is winter in Melbourne, so AEST (UTC+10): 15:30 local is 05:30Z.
  assert.equal(t.iso, '2026-07-29T05:30:00.000Z');
});

test('handles daylight saving, where the offset differs', () => {
  // January is AEDT (UTC+11), so 15:30 local is 04:30Z.
  const t = parseBomTimestamp('20260115153000', 'Australia/Melbourne');
  assert.equal(t.iso, '2026-01-15T04:30:00.000Z');
});

test('falls back to now on an unparseable timestamp instead of throwing', () => {
  const t = parseBomTimestamp('rubbish', 'Australia/Melbourne');
  assert.ok(!Number.isNaN(Date.parse(t.iso)));
});

test('falls through to the next station when the nearest one fails', async () => {
  __clearCache();
  const tried = [];
  const fetchImpl = async (url) => {
    tried.push(url);
    if (url.includes('94865')) return { ok: false, status: 503 };
    return { ok: true, json: async () => fixture };
  };

  const obs = await fetchSunshineWestObservation({ fetchImpl });
  assert.equal(tried.length, 2, 'should have tried Laverton then Essendon');
  assert.ok(tried[1].includes('95866'));
  assert.equal(obs.dryBulbC, 13.4);
});

test('reports every failure when no station is reachable', async () => {
  __clearCache();
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(
    () => fetchSunshineWestObservation({ fetchImpl }),
    /No BOM station reachable.*Laverton.*Essendon.*Melbourne Airport/s,
  );
});

test('caches responses so BOM is not hammered', async () => {
  __clearCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => fixture };
  };

  await fetchSunshineWestObservation({ fetchImpl });
  await fetchSunshineWestObservation({ fetchImpl });
  assert.equal(calls, 1, 'second call within the TTL should be served from cache');

  // Step past the 10-minute TTL.
  let clock = Date.now() + 11 * 60 * 1000;
  await fetchSunshineWestObservation({ fetchImpl, now: () => clock });
  assert.equal(calls, 2, 'should refetch once the cache entry has expired');
});

test('sends a browser-like user agent, because BOM 403s the default', async () => {
  __clearCache();
  let headers;
  const fetchImpl = async (url, init) => {
    headers = init.headers;
    return { ok: true, json: async () => fixture };
  };
  await fetchSunshineWestObservation({ fetchImpl });
  assert.match(headers['User-Agent'], /Mozilla/);
});
