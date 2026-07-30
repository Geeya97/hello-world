import test from 'node:test';
import assert from 'node:assert/strict';

import { currentHomeObservation } from '../src/observation.js';
import { __clearCache } from '../src/bom.js';
import { buildTextReport } from '../src/report.js';

/**
 * BOM returns 403 to traffic it judges automated and refuses some networks and
 * datacentre IP ranges outright — observed in practice, from two different
 * networks. A live presentation cannot depend on it, so the app falls back to
 * Open-Meteo for the same coordinates.
 *
 * The thing that must never break: a fallback report is labelled as such, so
 * another source's numbers are never passed off as a Bureau reading.
 */

const BOM_403 = { ok: false, status: 403 };

const OPEN_METEO_FORECAST = {
  hourly: {
    time: ['2026-07-30T12:00'],
    temperature_2m: [15.5],
    relative_humidity_2m: [70],
    dew_point_2m: [10.1],
    apparent_temperature: [14.0],
    wet_bulb_temperature_2m: [12.4],
    pressure_msl: [1016.0],
    wind_speed_10m: [11],
    wind_direction_10m: [270],
    precipitation: [0],
  },
};

/** Fake fetch: BOM always 403s, Open-Meteo answers. */
function fakeNetwork({ openMeteoFails = false } = {}) {
  const seen = [];
  return {
    seen,
    fetchImpl: async (url) => {
      seen.push(url);
      if (String(url).includes('bom.gov.au')) return BOM_403;
      if (openMeteoFails) throw new Error('getaddrinfo ENOTFOUND api.open-meteo.com');
      return { ok: true, json: async () => OPEN_METEO_FORECAST };
    },
  };
}

test.beforeEach(() => __clearCache());

test('falls back to Open-Meteo when BOM refuses the connection', async () => {
  const { fetchImpl, seen } = fakeNetwork();
  const obs = await currentHomeObservation({ fetchImpl });

  // All three BOM stations tried first — BOM is still the preferred source.
  assert.equal(seen.filter((u) => u.includes('bom.gov.au')).length, 3);
  assert.ok(seen.some((u) => u.includes('open-meteo')));

  assert.equal(obs.dryBulbC, 15.5);
  assert.equal(obs.wetBulbC, 12.4);
  assert.equal(obs.relativeHumidityPct, 70);
});

test('a fallback observation is labelled, never passed off as BOM', async () => {
  const { fetchImpl } = fakeNetwork();
  const obs = await currentHomeObservation({ fetchImpl });

  assert.equal(obs.fallbackFrom, 'bom');
  assert.match(obs.source, /Open-Meteo/);
  assert.match(obs.source, /Bureau of Meteorology unavailable/);
  assert.match(obs.fallbackReason, /403/);
});

test('the rendered fallback report does not claim to be a Bureau reading', async () => {
  const { fetchImpl } = fakeNetwork();
  const text = buildTextReport(await currentHomeObservation({ fetchImpl }));

  assert.match(text, /Source: Open-Meteo/);
  assert.doesNotMatch(text, /Source: Bureau of Meteorology$/m);
  // Still the home suburb, and still carries the readings that matter.
  assert.match(text, /Sunshine West, VIC 3020/);
  assert.match(text, /Wet bulb .+ 12\.4 °C/);
  assert.match(text, /Relative humidity .+ 70 %/);
});

test('keeps reporting Sunshine West, not wherever the fallback resolved', async () => {
  const { fetchImpl } = fakeNetwork();
  const obs = await currentHomeObservation({ fetchImpl });
  assert.equal(obs.location.suburb, 'Sunshine West');
  assert.equal(obs.location.state, 'VIC');
});

test('surfaces the original BOM error when the fallback also fails', async () => {
  const { fetchImpl } = fakeNetwork({ openMeteoFails: true });

  await assert.rejects(
    () => currentHomeObservation({ fetchImpl }),
    (err) => {
      // The BOM failure is the actionable one and must stay visible, but the
      // fallback failure has to be mentioned or the cause gets misdiagnosed.
      assert.match(err.message, /No BOM station reachable/);
      assert.match(err.message, /Open-Meteo fallback also failed/);
      return true;
    },
  );
});

test('a successful BOM read is used directly, with no fallback', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const payload = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/bom-laverton.json', import.meta.url)), 'utf8'),
  );

  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => payload };
  };

  const obs = await currentHomeObservation({ fetchImpl });

  assert.equal(obs.source, 'Bureau of Meteorology');
  assert.equal(obs.fallbackFrom, undefined);
  assert.equal(obs.wetBulbC, 11.2);
  assert.ok(!seen.some((u) => u.includes('open-meteo')), 'must not call the fallback when BOM works');
});

test('BOM_FALLBACK=0 fails loudly instead of falling back', async () => {
  // Re-imported with the flag set, since it is read at module load.
  process.env.BOM_FALLBACK = '0';
  const fresh = await import(`../src/observation.js?nofallback=${Date.now()}`);
  const { fetchImpl } = fakeNetwork();

  await assert.rejects(
    () => fresh.currentHomeObservation({ fetchImpl }),
    /No BOM station reachable/,
  );

  delete process.env.BOM_FALLBACK;
});
