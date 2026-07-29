import test from 'node:test';
import assert from 'node:assert/strict';

import { checkRecipient, isAllowedRecipient, REJECTION_MESSAGE } from '../src/recipients.js';

test('accepts addresses on the family domain', () => {
  const good = [
    'dad@refrigerationservices.com.au',
    'jane.doe@refrigerationservices.com.au',
    'service+jobs@refrigerationservices.com.au',
    'DAD@REFRIGERATIONSERVICES.COM.AU',
    '  spaced@refrigerationservices.com.au  ',
  ];
  for (const email of good) {
    assert.equal(isAllowedRecipient(email), true, `expected ${email} to be allowed`);
  }
});

test('rejects everything else, including lookalikes', () => {
  const bad = [
    'someone@gmail.com',
    'someone@refrigerationservices.com',            // missing .au
    'someone@refrigerationservices.com.au.evil.com', // suffix smuggling
    'evil.com@refrigerationservices.com.au.attacker.net',
    'someone@sub.refrigerationservices.com.au',      // subdomain is not the domain
    'someone@notrefrigerationservices.com.au',       // prefix smuggling
    'a@refrigerationservices.com.au, b@evil.com',    // list smuggled as one address
    'a@refrigerationservices.com.au;b@evil.com',
    '"a@refrigerationservices.com.au" <b@evil.com>',
    'a@refrigerationservices.com.au\nbcc: b@evil.com', // header injection attempt
    '@refrigerationservices.com.au',
    'refrigerationservices.com.au',
    '',
    null,
    undefined,
    42,
  ];
  for (const email of bad) {
    assert.equal(isAllowedRecipient(email), false, `expected ${JSON.stringify(email)} to be rejected`);
  }
});

test('checkRecipient returns the exact wording the business asked for', () => {
  assert.deepEqual(checkRecipient('stranger@gmail.com'), {
    ok: false,
    error: 'This email is not one of your family member',
  });
  assert.equal(REJECTION_MESSAGE, 'This email is not one of your family member');
});

test('checkRecipient distinguishes empty input from a disallowed domain', () => {
  const empty = checkRecipient('   ');
  assert.equal(empty.ok, false);
  assert.notEqual(empty.error, REJECTION_MESSAGE, 'blank input is a different problem to a wrong domain');
});

test('checkRecipient normalises accepted addresses', () => {
  assert.deepEqual(checkRecipient('  Dad@Refrigerationservices.Com.Au '), {
    ok: true,
    email: 'dad@refrigerationservices.com.au',
  });
});
