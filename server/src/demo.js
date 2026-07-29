/**
 * DEMO_MODE=1 serves a recorded BOM observation instead of calling the Bureau.
 *
 * Useful for working on the UI offline, for demos, and for environments whose
 * egress policy blocks bom.gov.au. The observation is real BOM output, recorded
 * from Laverton; only the timestamp is moved to the present so the page does not
 * look stale. Every response says it is demo data, so it can never be mistaken
 * for a live reading.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseBomPayload, SUNSHINE_WEST_STATIONS, describeInstant, SUNSHINE_WEST } from './bom.js';

export const DEMO_MODE = process.env.DEMO_MODE === '1';

const fixturePath = fileURLToPath(new URL('../test/fixtures/bom-laverton.json', import.meta.url));

let fixture = null;

export function demoObservation(now = new Date()) {
  if (!fixture) fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

  const observation = parseBomPayload(fixture, SUNSHINE_WEST_STATIONS[0]);
  return {
    ...observation,
    observedAt: describeInstant(now, SUNSHINE_WEST.timezone),
    source: 'Bureau of Meteorology (recorded sample — DEMO_MODE)',
    demo: true,
  };
}
