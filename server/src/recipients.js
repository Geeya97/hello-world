/**
 * The recipient rule: reports may only ever go to @refrigerationservices.com.au.
 *
 * This lives in its own module because it is enforced in three places — the web
 * UI, the Android UI, and the chat agent's send tool. The UI checks exist to give
 * fast feedback; the server-side check in the send path is the one that actually
 * enforces the rule, since chat input is untrusted and a model can be talked into
 * trying to send somewhere else.
 */

export const ALLOWED_DOMAIN = 'refrigerationservices.com.au';

/** The exact message the user asked for when an address fails the rule. */
export const REJECTION_MESSAGE = 'This email is not one of your family member';

/**
 * Anchored on both ends so nothing like `a@refrigerationservices.com.au.evil.com`
 * or `a@evil.com?x=@refrigerationservices.com.au` can slip through. The local part
 * excludes whitespace, `@` and commas so a comma-separated list can never be
 * smuggled in as a single "address".
 */
const ADDRESS_RE = /^[^\s@,;<>"]+@refrigerationservices\.com\.au$/i;

/** @returns {boolean} whether this address may receive a report. */
export function isAllowedRecipient(email) {
  if (typeof email !== 'string') return false;
  return ADDRESS_RE.test(email.trim());
}

/**
 * Validate and normalise, or explain the refusal.
 * @returns {{ ok: true, email: string } | { ok: false, error: string }}
 */
export function checkRecipient(email) {
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (!trimmed) return { ok: false, error: 'Enter an email address first.' };
  if (!isAllowedRecipient(trimmed)) return { ok: false, error: REJECTION_MESSAGE };
  return { ok: true, email: trimmed.toLowerCase() };
}
