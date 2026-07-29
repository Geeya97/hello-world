import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseBomPayload, SUNSHINE_WEST_STATIONS } from '../src/bom.js';
import { buildReport, buildTextReport, buildHtmlReport, buildSubject, displayWidth } from '../src/report.js';
import { normaliseOpenMeteo } from '../src/openmeteo.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/bom-laverton.json', import.meta.url)), 'utf8'),
);
const observation = parseBomPayload(fixture, SUNSHINE_WEST_STATIONS[0]);

test('the text report carries every field the business asked for', () => {
  const text = buildTextReport(observation);

  // Date, time, location.
  assert.match(text, /Wednesday 29 July 2026/);
  assert.match(text, /3:30 PM AEST/);
  assert.match(text, /Sunshine West, VIC 3020/);

  // The four readings that matter to a refrigeration crew.
  assert.match(text, /Dry bulb .+ 13\.4 °C/);
  assert.match(text, /Wet bulb .+ 11\.2 °C/);
  assert.match(text, /Relative humidity .+ 79 %/);
  assert.match(text, /Dew point .+ 9\.8 °C/);

  // Provenance.
  assert.match(text, /Observed at Laverton/);
  assert.match(text, /Source: Bureau of Meteorology/);
});

test('the report shows the wet-bulb depression alongside the wet bulb', () => {
  assert.match(buildTextReport(observation), /Δt 2\.2 °C/);
});

test('the report says how the wet bulb was obtained', () => {
  assert.match(buildTextReport(observation), /Wet bulb: BOM wet-bulb depression/);
});

test('the box frame lines up by rendered width, not code-point count', () => {
  const lines = buildTextReport(observation).split('\n');
  const frame = lines.slice(0, 4);
  const widths = frame.map(displayWidth);
  assert.ok(widths.every((w) => w === widths[0]), `frame widths differ: ${widths.join(', ')}`);
  for (const line of frame.slice(1, 3)) {
    assert.ok(line.startsWith('║') && line.endsWith('║'));
  }
});

test('no ambiguous-width characters sit inside the box frame', () => {
  // Glyphs like ☁ are one column in a terminal and two in a browser, so a frame
  // containing them cannot be square everywhere. Keep them out of it.
  const frame = buildTextReport(observation).split('\n').slice(0, 4).join('');
  for (const ch of frame) {
    const cp = ch.codePointAt(0);
    const ambiguous = (cp >= 0x2600 && cp <= 0x27bf) || cp > 0x1f000;
    assert.ok(!ambiguous, `found ambiguous-width character ${JSON.stringify(ch)} inside the frame`);
  }
});

test('missing readings are dashed out, never rendered as NaN or null', () => {
  const sparse = {
    ...observation,
    dryBulbC: null, wetBulbC: null, wetBulbDepressionC: null, dewPointC: null,
    apparentC: null, relativeHumidityPct: null, windSpeedKmh: null, windDir: null,
    gustKmh: null, pressureHpa: null, rainSince9amMm: null, wetBulbMethod: null,
  };
  const text = buildTextReport(sparse);
  assert.doesNotMatch(text, /NaN|null|undefined/);
  assert.match(text, /Dry bulb .+ —/);
});

test('the subject line names the place and the temperature', () => {
  const subject = buildSubject(observation);
  assert.match(subject, /Sunshine West/);
  assert.match(subject, /13\.4°C/);
});

test('the HTML report escapes values rather than interpolating markup', () => {
  const nasty = {
    ...observation,
    location: { ...observation.location, label: '<script>alert(1)</script>' },
  };
  const html = buildHtmlReport(nasty);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('the HTML report omits rows that have no value', () => {
  const html = buildHtmlReport({ ...observation, rainSince9amMm: null, apparentC: null });
  assert.doesNotMatch(html, /Rain since 9am/);
  assert.doesNotMatch(html, /Feels like/);
  assert.match(html, /Wet bulb/);
});

test('buildReport returns subject, text and html together', () => {
  const report = buildReport(observation);
  assert.deepEqual(Object.keys(report).sort(), ['html', 'subject', 'text']);
  assert.ok(report.text.length > 200);
  assert.ok(report.html.startsWith('<!doctype html>'));
});

test('an Open-Meteo report is clearly labelled as such, not as BOM', () => {
  const omObservation = normaliseOpenMeteo(
    {
      hourly: {
        time: ['2026-07-29T15:00'],
        temperature_2m: [18.2],
        relative_humidity_2m: [55],
        dew_point_2m: [9.1],
        apparent_temperature: [17.0],
        wet_bulb_temperature_2m: [13.1],
        pressure_msl: [1015.2],
        wind_speed_10m: [12],
        wind_direction_10m: [315],
        precipitation: [0],
      },
    },
    { label: 'Bondi, NSW', suburb: 'Bondi', state: 'NSW', lat: -33.89, lon: 151.27, timezone: 'Australia/Sydney' },
    new Date('2026-07-29T05:00:00Z'),
    { kind: 'historical' },
  );

  const text = buildTextReport(omObservation);
  assert.match(text, /Source: Open-Meteo — historical record/);
  assert.doesNotMatch(text, /Bureau of Meteorology/);
  assert.match(text, /Bondi, NSW/);
  assert.match(text, /Wet bulb .+ 13\.1 °C/);
  assert.match(text, /Precipitation/, 'non-BOM sources have no "since 9am" convention');
  assert.doesNotMatch(text, /Observed at/, 'Open-Meteo is modelled, not a station reading');
});

test('the same shape renders identically every time, so surfaces cannot drift', () => {
  assert.equal(buildTextReport(observation), buildTextReport(structuredClone(observation)));
});
