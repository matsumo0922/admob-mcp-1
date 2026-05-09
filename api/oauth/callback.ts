import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { KvTokenStore } from "../../src/token-store.js";
import type { StoredTokens } from "../../src/token-store.js";
import { ADMOB_OAUTH_SCOPES } from "../../src/auth.js";

export const config = { runtime: "nodejs20.x" };

function parseStateCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const m = /(?:^|;\s*)admob_oauth_state=([^;]+)/.exec(cookieHeader);
  return m ? m[1] : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const errorParam = typeof req.query.error === "string" ? req.query.error : null;

  if (errorParam) {
    res.status(400).send(`<h1>Authorization failed</h1><p>${escapeHtml(errorParam)}</p>`);
    return;
  }
  if (!code || !state) {
    res.status(400).send("<h1>Missing code or state</h1>");
    return;
  }

  const cookieState = parseStateCookie(req.headers["cookie"]);
  if (!cookieState || cookieState !== state) {
    res.status(400).send("<h1>State mismatch — possible CSRF</h1>");
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send("Server misconfigured.");
    return;
  }

  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  let tokens;
  try {
    const result = await oauth.getToken(code);
    tokens = result.tokens;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<h1>Token exchange failed</h1><pre>${escapeHtml(msg)}</pre>`);
    return;
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    res
      .status(400)
      .send(
        "<h1>Missing refresh_token</h1><p>Re-run the setup with prompt=consent. Make sure Google's consent screen lets you grant offline access.</p>",
      );
    return;
  }

  // Google may omit `scope` from the response when it matches what was
  // requested. Fall back to the scopes we asked for so getAuthenticatedClient
  // doesn't later reject the token as missing required AdMob scopes.
  const stored: StoredTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || "Bearer",
    expiry_date: tokens.expiry_date!,
    scope: tokens.scope || ADMOB_OAUTH_SCOPES.join(" "),
  };

  const store = new KvTokenStore();
  await store.save(stored);

  res.setHeader("Set-Cookie", "admob_oauth_state=; Path=/api/oauth; Max-Age=0");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(SUCCESS_HTML);
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorized</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:64px auto;padding:0 16px}
code{background:#f4f4f4;padding:2px 4px;border-radius:3px}</style></head>
<body>
<h1>✅ Authorized</h1>
<p>Your AdMob OAuth tokens are stored. Now add this server as a Connector in Claude.ai:</p>
<ol>
  <li>Go to Claude.ai → Settings → Connectors → <strong>Add custom connector</strong>.</li>
  <li>URL: <code>https://&lt;your-deploy&gt;.vercel.app/api/mcp</code></li>
  <li>Authentication: Bearer token (use the same <code>CONNECTOR_TOKEN</code> you just entered).</li>
</ol>
<p>You can close this window.</p>
</body></html>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}
