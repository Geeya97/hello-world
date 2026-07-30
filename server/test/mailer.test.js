import test from 'node:test';
import assert from 'node:assert/strict';

import { explainSmtpFailure, buildGmailComposeUrl } from '../src/mailer.js';

/**
 * A network that blocks SMTP and a wrong App Password both end with "no email
 * arrived", but they need completely different responses. These check the
 * explanation actually distinguishes them, because the symptom does not.
 */

test('a blocked SMTP port is identified as a network problem', () => {
  for (const err of [
    Object.assign(new Error('connect ETIMEDOUT 142.250.x.x:465'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    new Error('Greeting never received'),
    Object.assign(new Error('Socket closed'), { code: 'ESOCKET' }),
  ]) {
    const explanation = explainSmtpFailure(err);
    assert.match(explanation, /blocks outbound SMTP/, `misdiagnosed: ${err.message}`);
    assert.match(explanation, /draft was opened instead/);
  }
});

test('a rejected App Password is identified as a credentials problem', () => {
  for (const message of [
    'Invalid login: 535-5.7.8 Username and Password not accepted',
    'BadCredentials',
  ]) {
    const explanation = explainSmtpFailure(new Error(message));
    assert.match(explanation, /App Password/);
    assert.match(explanation, /2-Step Verification/);
    assert.doesNotMatch(explanation, /blocks outbound SMTP/, 'must not blame the network for a bad password');
  }
});

test("Gmail's daily limit is called out as its own case", () => {
  const explanation = explainSmtpFailure(new Error('550 Daily user sending limit exceeded'));
  assert.match(explanation, /daily sending limit/i);
  assert.match(explanation, /24 hours/);
});

test('an unrecognised failure still surfaces the underlying message', () => {
  const explanation = explainSmtpFailure(new Error('something entirely novel'));
  assert.match(explanation, /something entirely novel/);
});

test('the compose URL carries the recipient, subject and full report', () => {
  const url = buildGmailComposeUrl({
    to: 'dad@refrigerationservices.com.au',
    subject: 'Weather Dispatch',
    body: 'Wet bulb 11.2 °C',
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://mail.google.com/mail/');
  assert.equal(parsed.searchParams.get('view'), 'cm');
  assert.equal(parsed.searchParams.get('to'), 'dad@refrigerationservices.com.au');
  assert.equal(parsed.searchParams.get('su'), 'Weather Dispatch');
  assert.equal(parsed.searchParams.get('body'), 'Wet bulb 11.2 °C');
});
