# Presentation runbook

Everything needed to demonstrate the Current Weather App live, in order, with a fallback for
each thing that can go wrong.

---

## The three secrets you need

None of these should ever be pasted into a chat or committed to the repo.

| What | Where to get it | Notes |
| --- | --- | --- |
| `GMAIL_USER` | the Gmail address that will send | — |
| `GMAIL_APP_PASSWORD` | [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) | 16 characters. **Not your normal Gmail password** — Google blocks those from programs. Requires 2-Step Verification to be on, otherwise the page doesn't exist. |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Only needed for the chatbot section. Has a **free tier**, no card required. |

Paste the App Password with no spaces. Google displays it as `abcd efgh ijkl mnop`; enter it as
`abcdefghijklmnop`.

---

## Option A — hosted (recommended for a demo on someone else's WiFi)

Why: many venue, campus and corporate networks block outbound SMTP (ports 465/587). Sent from a
host, the email leaves a datacentre and the venue WiFi only has to load a web page.

1. Push this branch to GitHub (already done).
2. [Render dashboard](https://dashboard.render.com) → **New** → **Blueprint** → pick this repo.
   Render reads `render.yaml`.
3. It will prompt for `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `GEMINI_API_KEY`. Paste them there.
4. Wait for the first deploy, then note your URL, e.g. `https://current-weather-app.onrender.com`.
5. Confirm everything works:
   `https://your-url.onrender.com/api/preflight`

   That runs every read-only check. To also send a real test email from the host, set
   `PREFLIGHT_TOKEN` to a random string in Render's settings and then use:
   `…/api/preflight?deliverTo=you@refrigerationservices.com.au&token=YOUR_TOKEN`
   The token exists so a stranger who finds your URL cannot make it mail your family.

**Free plan caveat:** the instance sleeps after ~15 minutes idle and takes 30–60 seconds to wake.
Open the URL 5 minutes before you present and leave the tab open. If a cold start mid-presentation
is unacceptable, upgrade to Render's paid tier or use Railway, both of which stay awake.

## Option B — local on the presenting laptop

Why: no cold start, nothing external to fail. Needs Node.js installed and a network that permits
SMTP.

1. Install Node.js LTS from [nodejs.org](https://nodejs.org) — accept all defaults.
2. Clone or download this repo.
3. Double-click the launcher for your system:
   - Windows → `launch/start-windows.bat`
   - macOS → `launch/start-macos.command` (first time: right-click → Open → Open)
   - Linux → `launch/start-linux.sh`
4. It creates `server/.env` on first run. Open that file and fill in the three values, then close
   and re-launch.
5. Your browser opens at `http://localhost:8787`.

That URL only works on that laptop — which is fine, since that's the laptop driving the projector.

---

## 10 minutes before you start

```bash
cd server
PREFLIGHT_TO=you@refrigerationservices.com.au npm run check
```

Or, if hosted, open `/api/preflight?deliverTo=...` in a browser.

You want **Ready.** Every check names its own fix if it fails. Then:

- Open the inbox you sent the test to and **confirm the email actually arrived.** Gmail accepts
  mail for addresses that don't exist and bounces it minutes later, so "sent" is not proof.
- Leave the app tab open so a hosted instance can't fall asleep.
- Have the recipient inbox open in a second tab, ready to switch to.

---

## The demo

**Top section — Manual Dispatch**

1. Point out the live readings: dry bulb, **wet bulb**, humidity, and the provenance line naming
   Laverton and its distance from Sunshine West.
2. Expand *Preview the report that gets sent* to show the report format.
3. Press **Start**.
4. Type a wrong address first — `someone@gmail.com`. It refuses with *"This email is not one of
   your family member."* This is worth showing: it's the business rule working.
5. Type a real family address. Press **Send**. The report goes out and appears in **Sent this
   session** below, with the exact text that was delivered.
6. Send to a second and third address without closing the dialog — that's the loop.
7. Press **Give me a Break** to end it. A summary names everyone who received a report.
8. Switch to the inbox tab and show the report that arrived.

**Bottom section — Weather Ai Agent - Australia**

9. Ask *"What's the wet bulb in Bondi tomorrow at 2pm?"* — any Australian suburb, any date.
10. Ask it to email a report to a family address. It appears in the same session log.
11. Ask it to send to a `@gmail.com` address. It refuses with the same message — the rule is
    enforced on the server, not just in the chat prompt.

---

## If something fails

| Symptom | Cause | Do this |
| --- | --- | --- |
| Readings won't load | BOM unreachable or blocked | Set `DEMO_MODE=1` in `.env` and restart. Serves a recorded observation, clearly labelled. Demo continues. |
| Send fails, timeout | Network blocks SMTP | Set `MAIL_MODE=compose`. Each send opens a pre-filled Gmail draft you press Send on. Works on any network. |
| Send fails, "Invalid login" | Wrong App Password, or 2FA off | Regenerate it. Check for pasted spaces. |
| Chatbot says it needs a key | `GEMINI_API_KEY` missing or invalid | Run `npm run check`. The top section is unaffected; demo that instead. |
| Chatbot says quota exceeded | Gemini free-tier limit hit | Limits are per-minute as well as per-day. Wait a minute. **Don't rehearse the chatbot repeatedly right before presenting** — you can exhaust the daily quota. |
| Chatbot says the model is unavailable | Some models are closed to newer API keys | Set `GEMINI_MODEL=gemini-flash-latest`, which is verified working. |
| "localhost refused to connect" | Nothing is running | Launch the app first, or use the hosted URL. |
| Hosted URL slow to load | Free instance was asleep | Wait 60s. Warm it before presenting. |

**Worst case:** the Claude-space preview at
<https://claude.ai/code/artifact/3afa1727-1dc6-49fd-8aa8-f9530a636950> runs entirely offline on
bundled data. The loop, the rule and the report format all work; weather is a recorded sample and
the chatbot is scripted. Good enough to show the interaction if everything else is down.

---

## What is and isn't verified

**The live BOM fetch has never been run.** The container this was built in blocks `bom.gov.au`, so
the parser is verified only against a recorded payload. `npm run check` is the first thing that
will hit the real feed — run it well before the day, not on the morning.

**The Gemini agent is verified working.** Unlike BOM, `generativelanguage.googleapis.com` is
reachable from the build container, so the agent was tested end to end against the live API: it
calls the weather tool, quotes the real figures rather than inventing them, refuses non-family
recipients with the exact required wording, and produces a server-generated report for valid ones.

**Gmail sending is still unverified.** SMTP ports 25, 465 and 587 are all blocked from the build
container, so `verifyTransport()` has never succeeded. `npm run check` on your machine or the host
is the first real test of it.
