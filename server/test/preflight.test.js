import test from 'node:test';
import assert from 'node:assert/strict';

import { formatPreflight } from '../src/preflight.js';

/**
 * Preflight's value is entirely in whether a failure tells you what to do, so
 * that is what these assert.
 */

test('a clean run reads as ready', () => {
  const out = formatPreflight({
    ok: true,
    checks: [
      { name: 'Bureau of Meteorology', status: 'pass', detail: 'Laverton at 3:30 PM: dry bulb 13.4 °C.' },
      { name: 'Gmail sending', status: 'pass', detail: 'Authenticated as me@gmail.com.' },
    ],
  });

  assert.match(out, /Ready\. 2 of 2 checks passed/);
  assert.match(out, /\[  ok  \] Bureau of Meteorology/);
  assert.doesNotMatch(out, /fix →/);
});

test('a failure names the failing check and its fix', () => {
  const out = formatPreflight({
    ok: false,
    checks: [
      {
        name: 'Gmail sending',
        status: 'fail',
        detail: 'Gmail rejected the credentials.',
        fix: 'Use a 16-character App Password, not your normal Gmail password.',
      },
    ],
  });

  assert.match(out, /Not ready — 1 check failed: Gmail sending\./);
  assert.match(out, /\[ FAIL \] Gmail sending/);
  assert.match(out, /fix → Use a 16-character App Password/);
});

test('pluralises the failure count', () => {
  const out = formatPreflight({
    ok: false,
    checks: [
      { name: 'A', status: 'fail', detail: 'x', fix: 'y' },
      { name: 'B', status: 'fail', detail: 'x', fix: 'y' },
    ],
  });
  assert.match(out, /2 checks failed: A, B\./);
});

test('skipped checks are counted separately and do not fail the run', () => {
  const out = formatPreflight({
    ok: true,
    checks: [
      { name: 'A', status: 'pass', detail: 'fine' },
      { name: 'B', status: 'skip', detail: 'not configured' },
    ],
  });

  assert.match(out, /1 of 2 checks passed, 1 skipped/);
  assert.match(out, /\[ skip \] B/);
});

test('every failing check carries a fix', async () => {
  // A failure without a suggested fix is the thing this tool exists to avoid,
  // so hold the implementation to it.
  const { runPreflight } = await import('../src/preflight.js');
  const { checks } = await runPreflight({ deliverTo: null });

  for (const check of checks.filter((c) => c.status === 'fail')) {
    assert.ok(check.fix && check.fix.length > 20, `"${check.name}" failed without a usable fix`);
  }
});
