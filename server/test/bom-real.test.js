import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseBomPayload } from '../src/bom.js';
import { buildTextReport } from '../src/report.js';
import { computeWetBulb } from '../src/psychro.js';

/**
 * Parser tests against a GENUINE Bureau of Meteorology payload.
 *
 * bom-laverton.json was hand-written, so it only ever proved the parser agreed
 * with my own assumptions about BOM's field names. This fixture is real IDV60901
 * output — the same product the app fetches — captured from Melbourne (Olympic
 * Park) and trimmed to three rows. It is the thing that actually proves the field
 * names are right, since bom.gov.au is unreachable from the build container.
 *
 * Source: github.com/Muckthebuck/2023-Energy-kit (temp.json), 3 May 2023.
 */

const payload = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/bom-melbourne-real.json', import.meta.url)), 'utf8'),
);

const STATION = { name: 'Melbourne (Olympic Park)', product: 'IDV60901', wmo: '95936', bomId: '086338' };

test('the fixture really is the product the app fetches', () => {
  const header = payload.observations.header[0];
  assert.equal(header.ID, 'IDV60901', 'must be the same BOM product the app requests');
  assert.equal(header.state, 'Victoria');
  assert.equal(header.product_name, 'Capital City Observations');
});

test('parses every reading the report needs out of real BOM output', () => {
  const obs = parseBomPayload(payload, STATION);

  assert.equal(obs.dryBulbC, 14.8);
  assert.equal(obs.dewPointC, 7.8);
  assert.equal(obs.relativeHumidityPct, 63);
  assert.equal(obs.apparentC, 11.4);
  assert.equal(obs.windDir, 'WSW');
  assert.equal(obs.windSpeedKmh, 15);
  assert.equal(obs.gustKmh, 28);
  assert.equal(obs.pressureHpa, 1013.0);
  assert.equal(obs.rainSince9amMm, 0.6);
});

test('derives wet bulb from real delta_t', () => {
  const obs = parseBomPayload(payload, STATION);
  // air_temp 14.8 - delta_t 3.5
  assert.equal(obs.wetBulbC, 11.3);
  assert.equal(obs.wetBulbDepressionC, 3.5);
  assert.match(obs.wetBulbMethod, /delta_t/);
});

test('real delta_t stays consistent with Stull, confirming it is the depression', () => {
  const obs = parseBomPayload(payload, STATION);
  const stull = computeWetBulb({ airTemp: obs.dryBulbC, deltaT: null, relHum: obs.relativeHumidityPct });

  // Stull is an empirical fit, so they diverge a little on drier air; a whole
  // degree apart would mean we had misread what delta_t is.
  assert.ok(
    Math.abs(obs.wetBulbC - stull.celsius) < 1.0,
    `delta_t gave ${obs.wetBulbC}, Stull gave ${stull.celsius} — too far apart to be the same quantity`,
  );
  assert.ok(obs.wetBulbC < obs.dryBulbC, 'wet bulb must be below dry bulb');
  assert.ok(obs.wetBulbC > obs.dewPointC, 'wet bulb must sit between dew point and dry bulb');
});

test('takes the most recent of several real observation rows', () => {
  const obs = parseBomPayload(payload, STATION);
  // Rows run newest-first: 14:30 (14.8), 14:00 (14.3), 13:30 (12.2).
  assert.equal(obs.dryBulbC, 14.8);
  assert.equal(obs.observedAt.timeLabel, '2:30 PM');
});

test('reads BOM\'s local timestamp as Melbourne wall-clock time', () => {
  const obs = parseBomPayload(payload, STATION);
  assert.equal(obs.observedAt.dateLabel, 'Wednesday 3 May 2023');
  assert.equal(obs.observedAt.timeLabel, '2:30 PM');
  // 3 May is AEST (UTC+10), so 14:30 local is 04:30Z.
  assert.equal(obs.observedAt.iso, '2023-05-03T04:30:00.000Z');
});

test('computes the station\'s distance and bearing from Sunshine West', () => {
  const obs = parseBomPayload(payload, STATION);
  // Olympic Park is east of Sunshine West, roughly 15-20 km.
  assert.ok(obs.station.distanceKm > 10 && obs.station.distanceKm < 25, `got ${obs.station.distanceKm} km`);
  assert.equal(obs.station.bearing, 'E');
});

test('renders a complete report from real data with no gaps', () => {
  const text = buildTextReport(parseBomPayload(payload, STATION));

  // A missing reading renders as a dotted row ending in a dash. Match that
  // shape rather than the dash alone, which also appears legitimately in prose.
  assert.doesNotMatch(text, /\.{3,} —/, 'no reading should be missing from a full real observation');
  assert.doesNotMatch(text, /NaN|undefined|null/);
  assert.match(text, /Dry bulb .+ 14\.8 °C/);
  assert.match(text, /Wet bulb .+ 11\.3 °C {3}\(Δt 3\.5 °C\)/);
  assert.match(text, /Relative humidity .+ 63 %/);
  assert.match(text, /Source: Bureau of Meteorology/);
});
