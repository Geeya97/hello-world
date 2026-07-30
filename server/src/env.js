/**
 * Loads `.env` into process.env.
 *
 * Node 22 can do this with --env-file, but the flag name changed across versions
 * and the presenting laptop may have Node 20, so this does it in code instead:
 * one fewer thing to go wrong, no dependency, works on Node 18+.
 *
 * MUST be imported before anything that reads process.env at module scope
 * (mailer.js captures MAIL_MODE, demo.js captures DEMO_MODE), so it is the first
 * import in index.js.
 *
 * Real environment variables always win over the file — that is what makes the
 * same code work on a host, where secrets come from the dashboard and no .env
 * exists.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');

export function loadEnv(file = ENV_PATH) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { loaded: false, keys: [] };
    throw err;
  }

  const keys = [];
  for (const [key, value] of parseEnv(contents)) {
    // Don't clobber anything the host already set.
    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }

  return { loaded: true, keys };
}

/**
 * Parse the subset of .env syntax that matters: KEY=value, optional `export`
 * prefix, comments, blank lines, and quoted values (which may contain `#` and,
 * when double-quoted, escape sequences).
 *
 * @returns {Array<[string, string]>}
 */
export function parseEnv(contents) {
  const out = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();

    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // Unquoted: an inline comment ends the value.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out.push([key, value]);
  }

  return out;
}

loadEnv();
