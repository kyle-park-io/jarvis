# Google Calendar setup (one-time)

Jarvis reads your Google Calendar to subtract real meeting hours from each day's
capacity. It talks to Google's **official remote Calendar MCP server** and
authenticates with a Google OAuth token you authorize **once**. Google has no
service-account path for this, so a human has to approve access one time; after
that Jarvis refreshes the token headlessly.

This guide walks through creating the OAuth credentials and authorizing Jarvis.
It takes ~10 minutes and only has to be done once per machine.

> **Read-only.** Jarvis requests only read-only Calendar scopes — it reads your
> calendars/events to compute busy hours, and nothing else.

---

## 1. Create (or pick) a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. In the project picker (top bar), **New Project** (or select an existing one).
   Any project works; name it e.g. `jarvis`.

## 2. Enable the Calendar APIs (two of them)

In **APIs & Services → Library**, enable **both**:

1. **Google Calendar API**
2. **Google Calendar MCP API** (`calendarmcp.googleapis.com`) — the remote MCP
   server Jarvis actually talks to. It's a separate service from the Calendar
   API and is **required**; without it, tool calls fail with
   `The caller does not have permission`.

## 3. Configure the OAuth consent screen

*(In recent Console versions this lives under **APIs & Services → OAuth consent
screen**, sometimes labeled **Google Auth Platform**.)*

1. **User type: External** → Create.
2. Fill the required fields (App name e.g. `Jarvis`, your email for support +
   developer contact). You can skip everything optional.
3. **Scopes:** you don't need to add any here — Jarvis requests the three
   read-only Calendar MCP scopes (calendar list, free/busy, events) at sign-in.
4. **Test users:** add **your own Google address**. (While the app is in
   "Testing", only listed test users can authorize it — that's fine, you're the
   only user.)
5. Save. You do **not** need to publish or verify the app.

## 4. Create an OAuth client ID (Desktop app)

1. Go to **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID**.
3. **Application type: Desktop app** — this matters: Desktop clients allow the
   `http://127.0.0.1:<port>` loopback redirect Jarvis uses, with no redirect URI
   to register.
4. Create, then **copy the Client ID and Client secret**.

## 5. Put the credentials in `~/jarvis/.env`

Your secrets live next to your Jarvis data (not in the code repo). Edit
`~/jarvis/.env` (create it from `.env.example` if missing) and fill:

```
GOOGLE_OAUTH_CLIENT_ID=<your client id>.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=<your client secret>
```

*(If you use a non-default data directory, it's `$JARVIS_HOME/.env`.)*

## 6. Authorize Jarvis (one-time browser consent)

```
jarvis auth google
```

Jarvis prints a URL and waits. Open it, sign in, and approve:

- Because the app is **unverified** (you didn't publish it), Google shows a
  "Google hasn't verified this app" screen. Click **Advanced → Go to Jarvis
  (unsafe)** — you're the developer, this is expected.
- Approve the **read-only Calendar** access.

The browser redirects to Jarvis's local server, which stores your tokens in
`~/jarvis/google-token.json`. You should see **"Authorized — tokens saved."**

> Times out after 5 minutes if you don't finish — just run `jarvis auth google`
> again.

## 7. Verify

```
jarvis plan
```

Today's capacity should now be reduced by your real meeting hours. Done — Jarvis
refreshes the token automatically on future runs; you won't need to sign in
again unless you revoke access or delete `google-token.json`.

---

## Notes & troubleshooting

- **Security:** `~/jarvis/.env` and `~/jarvis/google-token.json` hold secrets —
  they live outside the code repo and must never be committed (the repo's
  `.gitignore` covers `.env`).
- **No Google set up?** Jarvis is fail-safe: with no credentials or token it
  assumes **0 committed hours** and works exactly as before.
- **Re-authorize / switch account:** delete `~/jarvis/google-token.json` and run
  `jarvis auth google` again.
- **"access_denied" / you clicked Cancel:** Jarvis reports it and exits — just
  re-run and approve.
- **Nothing subtracted from capacity:** confirm the event is a **timed** event
  (all-day events don't count) on your **primary** calendar for that date.
