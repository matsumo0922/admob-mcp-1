# Deploying AdMob MCP to Vercel as a Claude Connector

This guide walks you through deploying your own instance of the AdMob MCP server to Vercel and adding it to Claude.ai as a custom Connector. After setup, you can use the AdMob tools from Claude on any device — laptop, phone, or web.

This is a **single-tenant** deployment: your fork, your Google account, your AdMob data. Don't share the URL or `CONNECTOR_TOKEN` with anyone you wouldn't share AdMob console access with.

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

1. **Storage** tab → **Create Database** → **KV**.
2. Name it (e.g. `admob-tokens`) and connect it to your project.
3. Vercel auto-injects `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, etc. — you don't need to set them manually.

## 4. Create a Google OAuth client

1. Go to https://console.cloud.google.com/apis/credentials.
2. Pick the project that has the AdMob API enabled.
3. **Create Credentials → OAuth client ID → Application type: Web application**.
4. **Authorized redirect URIs**: add `https://<your-deploy>.vercel.app/api/oauth/callback` (use your actual Vercel deployment URL).
5. Save. Note the **Client ID** and **Client secret**.

If your Google Cloud OAuth consent screen is in **Testing** mode, refresh tokens expire after 7 days — fine for personal use, but plan to publish the consent screen if you want longer-lived auth.

## 5. Generate a CONNECTOR_TOKEN

A long random secret that gates your endpoints. Generate one:
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

Save. Vercel offers to redeploy — accept.

## 7. Authorize Google access

1. Visit `https://<your-deploy>.vercel.app/api/setup`.
2. Paste your `CONNECTOR_TOKEN`. Click **Authorize with Google**.
3. Sign in with the Google account that owns the AdMob publisher you want to query. Grant the requested scopes (`admob.readonly`, `admob.report`).
4. You'll be redirected back to a success page. Your tokens are now stored in Vercel KV.

## 8. Add the connector to Claude.ai

1. Claude.ai → **Settings → Connectors → Add custom connector**.
2. **URL:** `https://<your-deploy>.vercel.app/api/mcp`
3. **Authentication:** Bearer token. Paste your `CONNECTOR_TOKEN`.
4. Save. The connector now appears across all your Claude clients (web, mobile, desktop).

## Re-authorization

Refresh tokens can expire (especially with a Testing-mode consent screen). To re-authorize without changing your `CONNECTOR_TOKEN`:

1. Visit `https://<your-deploy>.vercel.app/api/setup`.
2. Paste your `CONNECTOR_TOKEN`, click Authorize, complete the Google flow.
3. Stored token in Vercel KV is overwritten.

## Rotating the CONNECTOR_TOKEN

1. Generate a new value: `openssl rand -hex 32`.
2. Update `CONNECTOR_TOKEN` in Vercel project env vars; redeploy.
3. Update the bearer in Claude.ai → Settings → Connectors → (your connector).

## Troubleshooting

- **`/api/mcp` returns 401**: bearer mismatch. Confirm Vercel env var matches what you pasted into Claude.ai.
- **`/api/oauth/callback` returns "State mismatch"**: cookie missing or stale; restart the flow at `/api/setup`.
- **Tools fail with `invalid_grant`**: refresh token expired. Re-authorize via step 7.
- **Function timeout (10s)**: you're on the Hobby tier. Either upgrade or only use lighter-weight tools. The `revenue_drop_diagnosis` and `app_deep_dive` tools fan out across many AdMob calls.
- **`KV_URL` not set**: Vercel KV not provisioned, or not linked to the project.

## Security notes

- The `CONNECTOR_TOKEN` is the only thing standing between an attacker and your AdMob data. Treat it like a password.
- Don't put the token in URL query strings — the `/api/setup` flow uses a POST form deliberately.
- Consider rotating the token if you suspect exposure.
- The Google OAuth callback URL is locked to your Vercel deploy in Google Cloud Console — even with a stolen `CONNECTOR_TOKEN`, an attacker cannot redirect tokens elsewhere without also editing your Google client.
