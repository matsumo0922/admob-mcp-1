# Deploying AdMob MCP to Vercel as a Claude Connector

This guide walks you through deploying your own instance of the AdMob MCP server to Vercel and adding it to Claude.ai as a custom Connector. After setup, you can use the AdMob tools from Claude on any device — laptop, phone, or web.

This is a **single-tenant** deployment: your fork, your Google account, your AdMob data. Don't share the URL or `CONNECTOR_TOKEN` with anyone you wouldn't share AdMob console access with.

## How the auth model works

There are **two OAuth flows** on this deployment, each gated by the same `CONNECTOR_TOKEN`:

- **Google ↔ your server** (`/api/setup` → `/api/oauth/callback`): one-time-per-deployment. Gives your server permission to read AdMob data on your behalf. Refresh tokens are stored in Vercel KV.
- **Claude.ai ↔ your server** (`/oauth/authorize` → `/oauth/token`): runs every time you click **Connect** in Claude.ai. Claude.ai's connector UI requires the server to implement OAuth 2.1 — there's no field for a static bearer token — so this deployment exposes the minimum endpoints needed (`/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`).

You manage one secret (`CONNECTOR_TOKEN`); both flows verify against it.

## Prerequisites

- A GitHub account.
- A Vercel account (free tier works).
- A Google Cloud project with the AdMob API enabled.
- An AdMob account with a publisher ID.

## 1. Fork the repo

Click **Fork** on https://github.com/willhou/admob-mcp.

## 2. Click Deploy to Vercel

In the README of your fork (or the upstream README), click the **Deploy to Vercel** button. Vercel imports the repo and asks you to fill in environment variables.

If you prefer the CLI: run `npm install -g vercel`, then from your forked clone:
```bash
vercel link
vercel deploy --prod
```

You'll add the env vars in the Vercel dashboard after the first deploy (the function code refuses to start until they're set, which is fine).

## 3. Provision Vercel KV

In your Vercel project dashboard:

1. **Storage** tab → **Create Database** → pick the **Upstash** card → **Redis**. (The legacy "Vercel KV" branding is gone; Upstash is the underlying provider and auto-injects the same `KV_*` env vars our code reads.)
2. Name it (e.g. `admob-tokens`), pick a region close to where you'll use it, and connect it to your project.
3. Vercel auto-injects `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, and `KV_REST_API_READ_ONLY_TOKEN` — you don't need to set them manually.

## 4. Create a Google OAuth client

1. Go to https://console.cloud.google.com/apis/credentials.
2. Pick the project that has the AdMob API enabled.
3. **Create Credentials → OAuth client ID → Application type: Web application**.
4. **Authorized redirect URIs**: add `https://<your-deploy>.vercel.app/api/oauth/callback` (use your actual Vercel deployment URL).
5. Save. Note the **Client ID** and **Client secret**.

If your Google Cloud OAuth consent screen is in **Testing** mode, refresh tokens expire after 7 days — fine for personal use, but plan to publish the consent screen if you want longer-lived auth.

## 5. Generate a CONNECTOR_TOKEN

A long random secret that gates both OAuth flows. Generate one:
```bash
openssl rand -hex 32
```
Or run `./setup.sh --mode=vercel` from a clone, which generates and prints one for you.

## 6. Set Vercel environment variables

In **Project Settings → Environment Variables**, add (Production scope):

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 4 |
| `GOOGLE_CLIENT_SECRET` | from step 4 |
| `OAUTH_REDIRECT_URI` | `https://<your-deploy>.vercel.app/api/oauth/callback` |
| `CONNECTOR_TOKEN` | the token from step 5 |

> ⚠️ Watch for stray whitespace. Vercel preserves leading/trailing spaces in env vars; a single accidental space in `GOOGLE_CLIENT_ID` will produce a confusing `Error 401: invalid_client` from Google.

Save. Vercel offers to redeploy — accept and wait for it to go green.

## 7. Authorize Google access (one-time)

1. Visit `https://<your-deploy>.vercel.app/api/setup`.
2. Paste your `CONNECTOR_TOKEN`. Click **Authorize with Google**.
3. Sign in with the Google account that owns the AdMob publisher you want to query. Grant the requested scopes (`admob.readonly`, `admob.report`).
4. You'll be redirected back to a success page. Your refresh token is now in Vercel KV.

## 8. Add the connector to Claude.ai

1. Claude.ai → **Settings → Connectors → Add custom connector**.
2. **Name:** AdMob (or whatever).
3. **URL:** `https://<your-deploy>.vercel.app/api/mcp`
4. **Leave both OAuth Client ID and OAuth Client Secret blank** (under Advanced settings). Claude.ai will dynamically register itself with your server.
5. Click **Add**.
6. Click **Connect** on the new entry. A browser tab opens at `/oauth/authorize`.
7. Paste your `CONNECTOR_TOKEN` (same value as step 5) and click **Authorize**.
8. You'll be redirected back to Claude.ai and the connector flips to **Connected** with all 36 tools.

The connector now works in Claude across web, desktop, and mobile.

## Re-authorization

There are two independent re-auths, and you usually only need one or the other.

**Google refresh token expired** (symptom: tools fail with `invalid_grant`):
1. Visit `https://<your-deploy>.vercel.app/api/setup` again.
2. Paste your `CONNECTOR_TOKEN`, click Authorize, complete the Google flow.
3. The KV token is overwritten. No change required on the Claude.ai side.

**Re-pair the Claude connector** (e.g. you rotated `CONNECTOR_TOKEN`, or want to revoke a specific device):
1. In Claude.ai → Settings → Connectors → your connector → remove it.
2. Re-add it (steps 1–8 above), pasting the current `CONNECTOR_TOKEN`.

## Rotating the CONNECTOR_TOKEN

Rotating `CONNECTOR_TOKEN` does **not** automatically revoke existing Claude.ai connections — Claude.ai holds an access token issued by `/oauth/token`, not the connector token itself. Full rotation:

1. Generate a new value: `openssl rand -hex 32`.
2. Update `CONNECTOR_TOKEN` in Vercel project env vars; redeploy.
3. (Optional, to invalidate already-issued access tokens) From the Vercel KV browser, delete all keys with prefix `oauth:token:`.
4. In Claude.ai, remove the connector and re-add it with the new token.

## Troubleshooting

- **`/api/mcp` returns 401 with `WWW-Authenticate: Bearer …`**: expected behavior when no/invalid bearer is sent. If it keeps happening for a properly added connector, the access token in Vercel KV may have been deleted — re-pair the connector in Claude.ai.
- **`/oauth/authorize` rejects your token (`Invalid CONNECTOR_TOKEN`)**: check Vercel env vars for stray whitespace.
- **Google "Authorization Error: invalid_client"** at the consent screen: `GOOGLE_CLIENT_ID` mismatch — usually a copy-paste artifact (leading/trailing space, wrong project's client ID).
- **`/api/oauth/callback` returns "State mismatch"**: cookie missing or stale; restart the flow at `/api/setup`.
- **Tools fail with `invalid_grant`**: your Google refresh token expired (commonly because the OAuth consent screen is in Testing mode). Re-authorize via step 7.
- **Vercel build error "Output Directory 'public' is empty"**: the repo ships a tiny `public/index.html` so this shouldn't happen on a clean fork. If it does, make sure `public/index.html` exists and is non-empty.
- **Function timeout (10s)**: you're on the Hobby tier. Either upgrade to Pro (60s) or stick to lighter-weight tools. The `revenue_drop_diagnosis` and `app_deep_dive` tools fan out across many AdMob calls and can hit the limit.
- **`KV_URL` not set**: Upstash Redis not provisioned, or not linked to the project.

## Security notes

- The `CONNECTOR_TOKEN` is the master secret for this deployment. Anyone with it can authorize a new Claude connection or re-auth Google. Treat it like a password.
- The token never appears in a URL — both `/api/setup` and `/oauth/authorize` use POST forms so the secret stays out of browser history, server logs, and `Referer` headers. Keep it that way if you modify the code.
- Access tokens issued by `/oauth/token` are random 32-byte values stored only in Vercel KV with a long TTL. They're never logged or exposed beyond the `Authorization: Bearer` header that Claude.ai sends back to `/api/mcp`.
- The Google OAuth callback URL is locked to your Vercel deploy in Google Cloud Console — even if `CONNECTOR_TOKEN` leaked, an attacker couldn't redirect Google tokens to a server they control without also editing your Google client.
- Comparison of `CONNECTOR_TOKEN` is timing-safe (`crypto.timingSafeEqual`).
- PKCE (S256) is required on the connector OAuth flow, preventing auth-code interception even if the redirect URL is somehow observed.
