import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The recipient rule is duplicated into web/recipients.js so the browser bundle
 * can validate without a build step, and ported into the Android app and the
 * Claude-space artifact. Those copies must not drift from the server's copy —
 * the server's is the one that actually enforces the rule, and a UI that
 * disagreed with it would either nag about valid addresses or wave through
 * invalid ones. These tests are the guard.
 */

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('web/recipients.js is byte-identical to the server copy', () => {
  assert.equal(
    read('../src/recipients.js'),
    read('../../web/recipients.js'),
    'web/recipients.js has drifted — re-copy it from server/src/recipients.js',
  );
});

/**
 * Kotlin string literals double their backslashes, so compare on the escaping-
 * insensitive form rather than on exact source text.
 */
const unescaped = (s) => s.replace(/\\+/g, '');

test('the Android port keeps the same domain, message and anchoring', () => {
  const kotlin = read('../../android/app/src/main/java/au/com/refrigerationservices/weather/data/Recipients.kt');

  assert.match(unescaped(kotlin), /@refrigerationservices\.com\.au\$/, 'domain must be anchored at the end');
  assert.match(kotlin, /This email is not one of your family member/);
  assert.match(kotlin, /"\^\[\^/, 'the pattern must be anchored at the start and exclude unsafe local-part chars');
  assert.match(kotlin, /IGNORE_CASE/, 'matching must be case-insensitive, as on the server');
});

test('the artifact port keeps the same domain, message and anchoring', () => {
  const artifact = read('../../artifact/weather-app.html');

  assert.match(unescaped(artifact), /@refrigerationservices\.com\.au\$/);
  assert.match(artifact, /This email is not one of your family member/);
});
