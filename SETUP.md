# Setup — the simple version

No coding. No terminal. No installing anything. Just websites and copy-paste.

At the end you'll have a web address like `https://current-weather-app.onrender.com` that opens
the app from any computer or phone, and it will send real emails.

Set aside about 20 minutes. Do it a few days before your presentation, not the morning of.

---

## Step 1 — Get your Gmail App Password (5 minutes)

An "App Password" is a special 16-letter password Google makes for one specific app. Your normal
Gmail password won't work here — Google blocks programs from using it. This one only sends mail,
and you can cancel it any time without changing your real password.

1. Go to **[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)**
2. Sign in if it asks.
3. In the box labelled **App name**, type: `Weather App`
4. Click **Create**.
5. A yellow box appears with 16 letters in four groups, like `abcd efgh ijkl mnop`.
6. **Copy those letters and remove the spaces**, so `abcd efgh ijkl mnop` becomes
   `abcdefghijklmnop`. Paste it somewhere safe for a minute — a blank note, not a chat.

> **Can't see the App name box?** Then 2-Step Verification isn't switched on for this account.
> Turn it on at [myaccount.google.com/signinoptions/twosv](https://myaccount.google.com/signinoptions/twosv),
> then come back to step 1.

---

## Step 2 — Get your Gemini key (3 minutes)

This is the brain for the chatbot at the bottom of the app. It's free.

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**
2. Click **Create API key**.
3. Copy the key it gives you. Keep it with the other one for a moment.

> Only the chatbot needs this. If it goes wrong, the weather-and-email half of the app still works.

---

## Step 3 — Put the app on the internet (10 minutes)

1. Go to **[dashboard.render.com](https://dashboard.render.com)** and sign up. Choose
   **Sign up with GitHub** — it's the quickest, and it lets Render see your code.
2. Click the **New** button (top right) and choose **Blueprint**.
3. Find **hello-world** in the repository list and click **Connect**.
4. **Important:** there's a **Branch** dropdown. Change it from `master` to:

   ```
   claude/current-weather-app-fi2ffg
   ```

   The app lives on that branch. If you leave it on `master` Render will say it can't find a
   blueprint file.
5. Render now reads its instructions and shows a form asking for a few values. Fill in:

   | Field | What to put |
   | --- | --- |
   | `GMAIL_USER` | your full Gmail address, e.g. `geethikaeranjana39@gmail.com` |
   | `GMAIL_APP_PASSWORD` | the 16 letters from Step 1, **no spaces** |
   | `GEMINI_API_KEY` | the key from Step 2 |
   | `PREFLIGHT_TOKEN` | make something up, e.g. `mysecret123` |

6. Click **Apply** / **Create Resources**.

   > **If Render won't let you use the free plan here** (it sometimes asks for a card, or only
   > offers paid plans through Blueprints): click **New → Web Service** instead, connect the same
   > repo and branch, and set **Build Command** to `cd server && npm install` and **Start Command**
   > to `cd server && npm start`. Then add the four values from the table above under
   > **Environment**. Same result, a couple more clicks.
7. Wait. The first build takes 2–5 minutes. You'll see a log scrolling. When it says **Live**,
   you're done.
8. At the top of the page is your web address, something like
   `https://current-weather-app.onrender.com`. **That's your app.** Click it.

---

## Step 4 — Check it actually works (2 minutes)

Open this in your browser, replacing the first part with your own address and putting your real
family mailbox after `deliverTo=`:

```
https://YOUR-ADDRESS.onrender.com/api/preflight?deliverTo=someone@refrigerationservices.com.au&token=mysecret123
```

You'll get a plain status page. At the top it says either **"Ready to go"** or **"Not ready yet"**.

Below that, every check has a green tick or a red cross. Anything with a red cross has a
**"What to do"** box underneath telling you exactly how to fix it. No code to read.

If it says Ready and you sent a test email — **go and check that mailbox now.** An email being
accepted is not the same as it arriving.

The most likely red cross is Gmail. If it says *"Gmail rejected the credentials"*, it's almost
always one of three things: you used your normal Gmail password, you left the spaces in the App
Password, or 2-Step Verification isn't on.

---

## Step 5 — Before you present

- **Open your app's address 5 minutes before you start**, and leave the tab open. The free plan
  puts the app to sleep after 15 minutes of nothing happening, and waking it takes up to a minute.
  Opening it early avoids an awkward silence.
- Have the family mailbox open in a second browser tab, ready to switch to.
- Don't test the chatbot over and over right beforehand — the free Gemini allowance is limited per
  day and you can use it all up.

Then follow **[DEMO.md](DEMO.md)** for what to click during the presentation.

---

## After the presentation

Go back to [dashboard.render.com](https://dashboard.render.com), open the service, and choose
**Suspend** or **Delete**.

Why: while the app is live, anyone who happens to know the address could make it send weather
emails to your family addresses. Nobody will guess it, and it can only send 12 a minute, so it's
fine for a presentation. But there's no reason to leave it switched on afterwards.

---

## If you get stuck

Copy the error message you see and send it over. The messages were written to say what's wrong and
what to do about it, so the text itself is usually enough to sort it out.
