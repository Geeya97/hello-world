# Current Weather App

Weather dispatches for a Melbourne refrigeration business. Two sections, three surfaces.

- **Manual Dispatch** — current Bureau of Meteorology conditions at Sunshine West, VIC, emailed
  to family addresses. Start opens a loop that keeps asking for the next address until you press
  **Give me a Break**.
- **Weather Ai Agent - Australia** — a Claude-powered agent that does the same job for any
  Australian suburb and any date, past or future.

| Surface | Where it lives | What it needs |
| --- | --- | --- |
| Web app | `web/`, served by `server/` | the backend running |
| Android app | `android/` | the backend reachable from the phone |
| Claude-space preview | `artifact/weather-app.html` | nothing — runs offline on bundled data |

---

## Quick start

```bash
cd server
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY for the chat agent
npm start                 # http://localhost:8787
```

The server also serves `web/`, so that one command gives you the whole web app on one origin.

No network access, or just working on the UI? `DEMO_MODE=1 npm start` serves a recorded BOM
observation instead of calling the Bureau. Every response is labelled as sample data.

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

---

## Where the weather comes from

**Sunshine West (top section) — Bureau of Meteorology.** Sunshine West has no BOM station, so
the app reads the nearest automatic weather station, **Laverton RAAF** (BOM 087031, WMO 94865),
and says so in every report rather than implying the reading was taken in the suburb. Essendon
Airport and Melbourne Airport are automatic fallbacks if Laverton is offline.

BOM's feed carries `delta_t`, which is the **wet-bulb depression** — so
`wet bulb = air_temp − delta_t` is a genuine BOM-derived value, not an estimate. Where `delta_t`
is missing, the app falls back to Stull's (2011) formula from dry bulb and humidity, and the
report says which was used. The two agree to 0.1 °C on the test fixture, which is what confirms
the reading of that field is right.

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

**`smtp`** — the server sends silently through Gmail. Requires 2-Step Verification on the Google
account and an App Password from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords):

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
fetch BOM, cannot run the Claude agent, and cannot send mail. What it does honestly is the whole
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
  chat.js        Anthropic proxy with tool use
  index.js       routes, CORS allowlist, rate limiting, static hosting
web/             browser front end
android/         Kotlin + Compose app
artifact/        the Claude-space preview
```

### API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | mail mode, whether the chat agent is configured |
| `GET /api/current` | BOM observation for Sunshine West + rendered report |
| `GET /api/weather?location=&datetime=` | any AU suburb, any date |
| `POST /api/send` | deliver a report to one allowed recipient |
| `POST /api/chat` | one agent turn |

---

## Testing

```bash
cd server && npm test     # 44 tests
```

Covers the BOM parser against a recorded payload, the wet-bulb maths against Stull's published
reference values, the recipient rule against a table of lookalikes and injection attempts, report
formatting, and drift between the rule's four copies.

Two things the development container cannot check, because its egress allowlist blocks
`bom.gov.au` and `open-meteo.com` and it has no Android SDK: **live API calls** and **compiling
the Android app**. Verify those after deploying. The web UI itself was driven end-to-end in
Chromium — the loop, both rejection cases, two successful sends, and the Gmail hand-off.
