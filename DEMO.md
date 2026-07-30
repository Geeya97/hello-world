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
| Amber notice: "Bureau refused this connection" | BOM blocks traffic it judges automated, and refuses some networks and datacentre IPs | **Nothing to do.** The app already fell back to Open-Meteo for the same location — still live weather, and every report names the source. Just mention it if asked. |
| Readings won't load at all | Both BOM and Open-Meteo unreachable | Set `DEMO_MODE=1` and restart. Serves a recorded observation, clearly labelled. Demo continues. |
| Toast: "This network blocks outbound SMTP" | Venue/campus/corporate WiFi blocks ports 465/587 | **Already handled** — a pre-filled Gmail draft opened instead; press Send in it. To avoid the extra tap entirely, present from a phone hotspot or set `MAIL_MODE=compose` so drafts are the expected behaviour. |
| Toast: "Gmail rejected the App Password" | Wrong password, spaces left in, or 2FA off | Regenerate it at myaccount.google.com/apppasswords. A draft still opened, so the demo continues. |
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

## How much can you test, and how long can it run?

**Weather lookups — effectively unlimited.** Observations are cached for 10 minutes, so refreshing
the page repeatedly does not re-hit the source. Test as much as you like.

**Emails — dozens are fine.** A free Gmail account sends roughly 500 a day through SMTP, and the
app caps itself at 12 a minute. Sending 20-30 test reports costs you nothing.

**The chatbot is the tight one.** Gemini's free tier is limited per minute *and* per day, and one
question costs **2-4 API calls**, not one, because the agent calls a tool and then answers. Budget
around **10-15 chatbot questions while rehearsing** and leave the rest for the day. If you see
"quota exceeded", waiting a minute usually clears the per-minute limit; the daily one resets after
24 hours. This is the only thing you can exhaust by over-rehearsing.

**How long it can stay running — indefinitely.** Render's free tier covers one service running
continuously. Two things to know:

- It sleeps after ~15 minutes with no visitors, and takes 30-60 seconds to wake.
- **While the app's tab is open it stays awake.** The page quietly pings the server every 10
  minutes and stops when you switch away. So open it before you present, leave the tab open, and
  there is no wake-up delay.

There is no limit on how long a session lasts. Leave it deployed for days if you like — just
suspend it afterwards.

---

## What is and isn't verified

**BOM often refuses to serve this app, and that is now handled.** Confirmed from two separate
networks: BOM returns 403 to traffic it judges automated. The app tries three BOM stations, then
falls back to Open-Meteo for the same coordinates, labelling the source in the report and on the
page. The weather section works either way — you may just be showing Open-Meteo data rather than
Bureau data. The parser itself is verified against a genuine BOM payload, so if BOM does answer,
the readings will be correct.

**The Gemini agent is verified working.** Unlike BOM, `generativelanguage.googleapis.com` is
reachable from the build container, so the agent was tested end to end against the live API: it
calls the weather tool, quotes the real figures rather than inventing them, refuses non-family
recipients with the exact required wording, and produces a server-generated report for valid ones.

**Gmail sending is still unverified.** SMTP ports 25, 465 and 587 are all blocked from the build
container, so `verifyTransport()` has never succeeded. `npm run check` on your machine or the host
is the first real test of it.
