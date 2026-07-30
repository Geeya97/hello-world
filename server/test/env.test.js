import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEnv, parseEnv } from '../src/env.js';

/**
 * The bug these guard against: the README told users to create a .env, but
 * nothing read it, so every secret they set was silently ignored.
 */

test('parses plain assignments', () => {
  assert.deepEqual(parseEnv('MAIL_MODE=smtp\nPORT=8787'), [
    ['MAIL_MODE', 'smtp'],
    ['PORT', '8787'],
  ]);
});

test('ignores comments and blank lines', () => {
  const parsed = parseEnv('# a comment\n\n  \nMAIL_MODE=smtp\n# another');
  assert.deepEqual(parsed, [['MAIL_MODE', 'smtp']]);
});

test('accepts an export prefix', () => {
  assert.deepEqual(parseEnv('export GMAIL_USER=me@gmail.com'), [['GMAIL_USER', 'me@gmail.com']]);
});

test('keeps quoted values intact, including spaces and hashes', () => {
  assert.deepEqual(parseEnv('A="hello world"'), [['A', 'hello world']]);
  assert.deepEqual(parseEnv('B="value # not a comment"'), [['B', 'value # not a comment']]);
  assert.deepEqual(parseEnv("C='single quoted'"), [['C', 'single quoted']]);
});

test('strips an inline comment from an unquoted value', () => {
  assert.deepEqual(parseEnv('A=abc # trailing note'), [['A', 'abc']]);
});

test('keeps a hash that is part of an unquoted value', () => {
  // Only " #" (space then hash) starts a comment, so passwords containing # survive.
  assert.deepEqual(parseEnv('PASS=abc#def'), [['PASS', 'abc#def']]);
});

test('handles values containing an equals sign, like base64 padding', () => {
  assert.deepEqual(parseEnv('KEY=abc=def=='), [['KEY', 'abc=def==']]);
});

test('unescapes newlines in double-quoted values', () => {
  assert.deepEqual(parseEnv('A="one\\ntwo"'), [['A', 'one\ntwo']]);
});

test('rejects malformed keys rather than setting rubbish', () => {
  assert.deepEqual(parseEnv('not a key=value\n9BAD=x\n=novalue'), []);
});

test('a missing .env is not an error — hosts supply real env vars instead', () => {
  assert.deepEqual(loadEnv('/definitely/not/here/.env'), { loaded: false, keys: [] });
});

test('real environment variables win over the file', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const dir = mkdtempSync(path.join(tmpdir(), 'env-test-'));
  const file = path.join(dir, '.env');
  writeFileSync(file, 'ENV_TEST_PRESET=from-file\nENV_TEST_FRESH=from-file\n');

  process.env.ENV_TEST_PRESET = 'from-host';
  delete process.env.ENV_TEST_FRESH;

  const result = loadEnv(file);

  assert.equal(process.env.ENV_TEST_PRESET, 'from-host', 'must not clobber a host-provided value');
  assert.equal(process.env.ENV_TEST_FRESH, 'from-file');
  assert.deepEqual(result.keys, ['ENV_TEST_FRESH']);

  delete process.env.ENV_TEST_PRESET;
  delete process.env.ENV_TEST_FRESH;
});
