/**
 * Delivery. Two modes, chosen by configuration:
 *
 *  - "compose" (default): we hand back a Gmail compose URL / mailto: link with the
 *    report already filled in, and you tap Send in your own Gmail. No credentials
 *    exist anywhere in this project, so there is nothing to leak.
 *
 *  - "smtp" (opt-in): the server sends silently through Gmail SMTP using a Google
 *    App Password. Enable by setting MAIL_MODE=smtp plus GMAIL_USER and
 *    GMAIL_APP_PASSWORD in the server environment. Never commit those.
 */

import { checkRecipient } from './recipients.js';

export const MAIL_MODE = (process.env.MAIL_MODE ?? 'compose').toLowerCase();

/** Gmail's web compose deep link — opens the Gmail app on Android, gmail.com on desktop. */
export function buildGmailComposeUrl({ to, subject, body }) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${params}`;
}

/** Plain mailto:, for anyone whose default mail client is not Gmail on the web. */
export function buildMailtoUrl({ to, subject, body }) {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(to)}?${params}`;
}

let transportPromise = null;

/**
 * Authenticate against Gmail without sending anything.
 *
 * Called by preflight and once at startup, so a wrong App Password surfaces
 * immediately rather than on the first send in front of an audience.
 */
export async function verifyTransport() {
  const transport = await getTransport();
  await transport.verify();
  return true;
}

async function getTransport() {
  if (!transportPromise) {
    transportPromise = (async () => {
      const { default: nodemailer } = await import('nodemailer');
      const user = requireEnv('GMAIL_USER');
      const pass = requireEnv('GMAIL_APP_PASSWORD');
      return nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
        // Without these, a network that blocks SMTP leaves the request hanging
        // for minutes on nodemailer's defaults, and the UI spins with no
        // explanation. Fail fast enough to fall back instead.
        connectionTimeout: 12_000,
        greetingTimeout: 8_000,
        socketTimeout: 20_000,
      });
    })();
  }
  return transportPromise;
}

/**
 * Deliver one report.
 *
 * The recipient is re-validated here regardless of what the caller claims to have
 * checked — this function is the last gate before anything leaves the building.
 *
 * @returns {Promise<{ delivered: boolean, mode: string, to: string, composeUrl?: string, mailtoUrl?: string, messageId?: string }>}
 */
export async function sendReport({ to, subject, text, html }) {
  const check = checkRecipient(to);
  if (!check.ok) {
    const err = new Error(check.error);
    err.status = 400;
    err.code = 'RECIPIENT_NOT_ALLOWED';
    throw err;
  }
  const recipient = check.email;

  if (MAIL_MODE === 'smtp') {
    try {
      const transport = await getTransport();
      const info = await transport.sendMail({
        from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
        to: recipient,
        subject,
        text,
        html,
      });
      return { delivered: true, mode: 'smtp', to: recipient, messageId: info.messageId };
    } catch (err) {
      // Automatic sending failed. Rather than leaving the operator with nothing —
      // which mid-presentation is the worst possible outcome — degrade to a
      // pre-filled Gmail draft, and say why so the cause is visible rather than
      // silently swallowed. Set SMTP_FALLBACK=0 to fail hard instead.
      if (process.env.SMTP_FALLBACK === '0') throw err;

      return {
        delivered: false,
        mode: 'compose',
        fellBackFrom: 'smtp',
        reason: explainSmtpFailure(err),
        to: recipient,
        composeUrl: buildGmailComposeUrl({ to: recipient, subject, body: text }),
        mailtoUrl: buildMailtoUrl({ to: recipient, subject, body: text }),
      };
    }
  }

  // Compose mode: the client opens these and the human presses Send.
  return {
    delivered: false,
    mode: 'compose',
    to: recipient,
    composeUrl: buildGmailComposeUrl({ to: recipient, subject, body: text }),
    mailtoUrl: buildMailtoUrl({ to: recipient, subject, body: text }),
  };
}

/**
 * Turn a nodemailer failure into something worth reading. The two causes look
 * nothing alike but produce the same symptom — no email — so they must not be
 * reported the same way.
 */
export function explainSmtpFailure(err) {
  const message = err?.message ?? String(err);
  const code = err?.code ?? '';

  if (/Invalid login|Username and Password not accepted|BadCredentials|535/i.test(message)) {
    return 'Gmail rejected the App Password. Check it is the 16-character App Password with no spaces, and that 2-Step Verification is on.';
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ESOCKET|EDNS|timeout|greeting never received/i.test(`${code} ${message}`)) {
    return 'This network blocks outbound SMTP (ports 465/587), which is common on venue, campus and corporate WiFi. A Gmail draft was opened instead.';
  }
  if (/Daily user sending limit|550/i.test(message)) {
    return "Gmail's daily sending limit has been reached. It resets after 24 hours.";
  }
  return `Automatic sending failed: ${message}`;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `MAIL_MODE=smtp requires ${name}. Set it in the server environment, or leave MAIL_MODE unset to use Gmail compose links instead.`,
    );
  }
  return v;
}
