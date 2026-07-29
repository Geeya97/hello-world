import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeWetBulb,
  dewPointMagnus,
  relativeHumidityFromDewPoint,
  wetBulbDepression,
  wetBulbStull,
} from '../src/psychro.js';

test('Stull matches published reference values', () => {
  // Reference pairs from Stull (2011), "Wet-Bulb Temperature from Relative
  // Humidity and Air Temperature", J. Appl. Meteor. Climatol. 50, 2267-2269.
  const cases = [
    { t: 20, rh: 50, expected: 13.7 },
    { t: 25, rh: 60, expected: 19.5 },
    { t: 30, rh: 40, expected: 20.4 },
    { t: 35, rh: 20, expected: 19.3 },
  ];
  for (const { t, rh, expected } of cases) {
    const got = wetBulbStull(t, rh);
    assert.ok(
      Math.abs(got - expected) < 0.1,
      `Stull(${t}degC, ${rh}%) = ${got.toFixed(2)}, expected about ${expected}`,
    );
  }
});

test('wet bulb prefers BOM delta_t when present', () => {
  const result = computeWetBulb({ airTemp: 13.4, deltaT: 2.2, relHum: 79 });
  assert.equal(result.celsius, 11.2);
  assert.match(result.method, /delta_t/);
  assert.equal(result.approximate, false);
});

test('delta_t and Stull agree, confirming delta_t is the wet-bulb depression', () => {
  // If these ever diverge meaningfully, our reading of the BOM field is wrong.
  const fromBom = computeWetBulb({ airTemp: 13.4, deltaT: 2.2, relHum: 79 });
  const fromStull = computeWetBulb({ airTemp: 13.4, deltaT: null, relHum: 79 });
  assert.ok(
    Math.abs(fromBom.celsius - fromStull.celsius) <= 0.3,
    `delta_t gave ${fromBom.celsius}, Stull gave ${fromStull.celsius}`,
  );
});

test('wet bulb falls back to Stull when delta_t is missing', () => {
  const result = computeWetBulb({ airTemp: 13.4, deltaT: null, relHum: 79 });
  assert.equal(result.celsius, 11.1);
  assert.match(result.method, /Stull/);
  assert.equal(result.approximate, false);
});

test('wet bulb is flagged approximate outside Stull\'s validated range', () => {
  const result = computeWetBulb({ airTemp: 60, deltaT: null, relHum: 2 });
  assert.equal(result.approximate, true, 'should not imply precision it does not have');
});

test('wet bulb is null rather than invented when inputs are missing', () => {
  assert.equal(computeWetBulb({ airTemp: null, deltaT: null, relHum: null }), null);
  assert.equal(computeWetBulb({ airTemp: 13.4, deltaT: null, relHum: null }), null);
});

test('wet bulb never exceeds dry bulb', () => {
  for (let t = -10; t <= 45; t += 5) {
    for (let rh = 5; rh <= 99; rh += 10) {
      const { celsius } = computeWetBulb({ airTemp: t, deltaT: null, relHum: rh });
      assert.ok(celsius <= t + 0.15, `wet bulb ${celsius} exceeded dry bulb ${t} at ${rh}% RH`);
    }
  }
});

test('dew point round-trips through relative humidity', () => {
  const td = dewPointMagnus(20, 60);
  assert.ok(Math.abs(td - 12.0) < 0.3, `dew point was ${td.toFixed(2)}`);
  assert.ok(Math.abs(relativeHumidityFromDewPoint(20, td) - 60) < 0.5);
});

test('wetBulbDepression is the difference, or null when unknowable', () => {
  assert.equal(wetBulbDepression(13.4, 11.2), 2.2);
  assert.equal(wetBulbDepression(13.4, null), null);
});
