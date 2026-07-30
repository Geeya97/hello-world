# Current Weather App

Weather dispatches for a Melbourne refrigeration business. Two sections, three surfaces.

- **Manual Dispatch** — current Bureau of Meteorology conditions at Sunshine West, VIC, emailed
  to family addresses. Start opens a loop that keeps asking for the next address until you press
  **Give me a Break**.
- **Weather Ai Agent - Australia** — an AI agent (Gemini by default, Claude optional) that does
  the same job for any Australian suburb and any date, past or future.

| Surface | Where it lives | What it needs |
| --- | --- | --- |
| Web app | `web/`, served by `server/` | the backend running |
| Android app | `android/` | the backend reachable from the phone |
| Claude-space preview | `artifact/weather-app.html` | nothing — runs offline on bundled data |

---

**Not a coder? Start with [SETUP.md](SETUP.md)** — getting this online with working email, in
clicks, no terminal.

**Presenting with this? Read [DEMO.md](DEMO.md)** — the runbook, including the preflight check and
a fallback for everything that can fail on the day.

---

## Quick start

**No terminal:** double-click the launcher for your system. It installs what's needed on first
run, starts the app, and opens your browser.

- Windows → `launch/start-windows.bat`
- macOS → `launch/start-macos.command` (first time: right-click → Open → Open)
- Linux → `launch/start-linux.sh`

**Or by hand:**

```bash
cd server
npm install
cp .env.example .env      # then fill in the secrets
npm start                 # http://localhost:8787
```

The server also serves `web/`, so that one command gives you the whole web app on one origin.

`localhost` means "this computer" — that URL only works on the machine running the app. To get a
URL that works anywhere, deploy it (see below).

### Check everything works before you rely on it

```bash
cd server
npm run check                                              # BOM, Open-Meteo, Gemini, Gmail
PREFLIGHT_TO=you@refrigerationservices.com.au npm run check # ...and send one real email
```

Each failure names its own fix. Also available as `GET /api/preflight` so it can be run against a
deployed instance.

No network, or just working on the UI? Put `DEMO_MODE=1` in `server/.env` to serve a recorded BOM
observation instead of calling the Bureau. Every response is labelled as sample data.

---

## Deploying

`render.yaml` is ready for [Render](https://dashboard.render.com): **New → Blueprint → pick this
repo**, then paste the three secrets when prompted. You get a permanent HTTPS URL and pushing a
commit redeploys.

Render, Railway and Fly all work. **Vercel, Netlify and Cloudflare Workers do not** — they are
serverless and cannot open the SMTP connection Gmail sending needs.

### Know this before you leave it deployed

`POST /api/send` has **no authentication**. Anyone who learns the URL can make the app email
`@refrigerationservices.com.au` addresses, capped at `SEND_RATE_LIMIT_MAX` (12) per minute per IP.
That is an acceptable trade for a presentation on an unadvertised URL — it keeps the demo free of a
login step — but it is not something to leave running indefinitely. **Delete or suspend the Render
service once the presentation is done**, or add authentication in front of it.

Test sends through `GET /api/preflight?deliverTo=` are gated behind `PREFLIGHT_TOKEN` for the same
reason, and are ignored entirely unless that variable is set.

---

## The two rules that matter

**Reports only go to `@refrigerationservices.com.au`.** Anything else is refused with the exact
wording *"This email is not one of your family member"*.

The rule lives in `server/src/recipients.js` and is enforced there — in the send path, before
anything leaves the building. The copies in `web/recipients.js`, `android/.../Recipients.kt` and
the artifact exist only so the UI can give instant feedback; `server/test/shared-rule.test.js`
fails the build if any of them drifts. The pattern is anchored at both ends, so lookalikes like
`a@refrigerationservices.com.au.evil.com` are rejected, and the local part excludes the
characters used to smuggle a second recipient through.

**The chat agent never writes an email.** Its send tool takes only a place, a time and a
recipient; the server generates the report from real data and sends that. So the agent cannot
email invented weather, and cannot use the mail path to send arbitrary text to anyone. The
domain rule is applied in the tool handler, not merely requested in the system prompt — chat
input is untrusted, and a prompt-level restriction is a suggestion rather than a rule.

Both providers share that one `runTool` implementation, so swapping brains cannot loosen the
rule. Verified against live Gemini: asked to email a `@gmail.com` address it replies with exactly
*"This email is not one of your family member"* and performs no send.

---

## Where the weather comes from

**Sunshine West (top section) — Bureau of Meteorology.** Sunshine West has no BOM station, so
the app reads the nearest automatic weather station, **Laverton RAAF** (BOM 087031, WMO 94865),
and says so in every report rather than implying the reading was taken in the suburb. Essendon
Airport and Melbourne Airport are automatic fallbacks if Laverton is offline.

BOM's feed carries `delta_t`, which is the **wet-bulb depression** — so
`wet bulb = air_temp − delta_t` is a genuine BOM-derived value, not an estimate. Where `delta_t`
is missing, the app falls back to Stull's (2011) formula from dry bulb and humidity, and the
report says which was used. The two agree to within a degree, which is what confirms that reading
of the field is right.

The parser is tested against a **genuine BOM payload** — real IDV60901 output from Melbourne
(Olympic Park), in `server/test/fixtures/bom-melbourne-real.json`. That matters because
`bom.gov.au` is unreachable from the development container, so a hand-written fixture would only
have proved the parser agreed with my own assumptions about BOM's field names. Every field the
parser reads is present in the real data.

BOM has no CORS headers and rejects non-browser clients, which is why this has to be fetched
server-side. Their guidance asks for at most one request per minute per product, so responses
are cached for ten minutes.

**Everywhere else (the agent) — Open-Meteo.** BOM publishes no usable API for arbitrary suburbs
or arbitrary past/future dates. Open-Meteo needs no API key, reaches back to 1940 and forward
about 16 days, and returns `wet_bulb_temperature_2m` directly. Every report names its own source,
so a BOM report is never mistaken for a modelled one.

---

## Email delivery

Two modes, set by `MAIL_MODE`.

**`compose` (default)** — the app hands Gmail a draft with the recipient, subject and full report
already filled in, and you press Send. On Android this is a native Gmail intent. No credentials
exist anywhere in this project, so there is nothing to leak.

**`smtp`** — the server sends silently through Gmail. An **App Password** is a 16-character code
Google generates for one specific program; your normal Gmail password will not work, because
Google blocked password sign-in for scripts in 2022. It requires 2-Step Verification to be on,
and you get it from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords):

```bash
MAIL_MODE=smtp
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
```

Keep those in the server environment. Never in the repo, and never in the Android app.

---

## The Android app

Kotlin and Jetpack Compose, Material 3, minSdk 26. It renders the report text the backend
produces rather than carrying its own formatter, so the phone, the browser and the emails cannot
disagree about what a report looks like.

There is no Android SDK in the development container, so **the APK is built by CI**:
`.github/workflows/android.yml` runs the unit tests and uploads a debug APK to the run's
Artifacts. Or build locally:

```bash
cd android
./gradlew assembleDebug -PapiBaseUrl=https://your-backend
```

`apiBaseUrl` defaults to `http://10.0.2.2:8787` — the host machine as seen from the Android
emulator, so a debug build talks to a server on your laptop with no configuration. Cleartext
HTTP is permitted only for local development hosts; any deployed backend must be HTTPS.

---

## The Claude-space preview

`artifact/weather-app.html` is published at
<https://claude.ai/code/artifact/3afa1727-1dc6-49fd-8aa8-f9530a636950> (private until you share it).

A published artifact runs under a strict CSP with **no network access at all**, so it cannot
fetch BOM, cannot run the AI agent, and cannot send mail. What it does honestly is the whole
interaction — the dispatch loop, the recipient rule, the report format — on a bundled recorded
observation, and it opens a real pre-filled Gmail draft. The page says so at the top.

---

## Layout

```
server/src/
  bom.js         BOM fetch, parse, station fallback, 10-minute cache
  psychro.js     wet bulb (delta_t primary, Stull fallback), dew point
  openmeteo.js   geocoding, forecast, archive
  report.js      the report format — text + HTML, single source of truth
  recipients.js  the domain rule
  mailer.js      Gmail compose links, or SMTP when enabled
  chat.js        agent prompt, tool definitions, tool enforcement
  llm/gemini.js  Gemini provider (REST, function calling)
  llm/anthropic.js  Claude provider, optional via LLM_PROVIDER
  index.js       routes, CORS allowlist, rate limiting, static hosting
web/             browser front end
android/         Kotlin + Compose app
artifact/        the Claude-space preview
```

### API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | mail mode, whether the chat agent is configured |
| `GET /api/preflight` | run every dependency check; readable page in a browser, JSON to scripts |
| `GET /api/current` | BOM observation for Sunshine West + rendered report |
| `GET /api/weather?location=&datetime=` | any AU suburb, any date |
| `POST /api/send` | deliver a report to one allowed recipient |
| `POST /api/chat` | one agent turn |

---

## Testing

```bash
cd server && npm test     # 84 tests
```

Covers the BOM parser against both a hand-written and a **real** BOM payload, the wet-bulb maths
against Stull's published reference values, the recipient rule against a table of lookalikes and
injection attempts, report formatting, `.env` parsing, preflight result formatting, the Gemini wire
format (tool-result role, thought-signature echoing, error translation), and drift between the
recipient rule's four copies.

**Verified live:** the Gemini agent, end to end — it calls the weather tool, quotes the real
figures, and refuses non-family recipients with the exact required wording. The web UI was driven
in Chromium: the loop, both rejection cases, successful sends, the Gmail hand-off, and the
sent-reports log.

**Not verifiable here:** the development container's egress allowlist blocks `bom.gov.au` and
`open-meteo.com`, all SMTP ports (25/465/587) are closed, and there is no Android SDK. So a live
BOM fetch, a live Open-Meteo lookup, real Gmail delivery and the Android build have never run.
`npm run check` on a real network is what confirms the first three.
