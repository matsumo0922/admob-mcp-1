import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { randomBytes } from "crypto";
import { checkBearer } from "../src/http-auth.js";
import { ADMOB_OAUTH_SCOPES } from "../src/auth.js";

const FORM_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AdMob MCP Setup</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px}
input{width:100%;padding:8px;font-size:14px;margin:8px 0}
button{padding:10px 16px;font-size:14px}</style></head>
<body>
<h1>AdMob MCP — Authorize</h1>
<p>Paste your <code>CONNECTOR_TOKEN</code> (from Vercel env vars) and click Authorize.
You'll be sent to Google's consent screen, then back here.</p>
<form method="POST" action="/api/setup">
  <input type="password" name="token" placeholder="CONNECTOR_TOKEN" autocomplete="off" required>
  <button type="submit">Authorize with Google</button>
</form>
</body></html>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(FORM_HTML);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const submitted =
    typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, string>).token
      : undefined;

  if (!checkBearer(submitted ? `Bearer ${submitted}` : undefined)) {
    res.status(401).send("Invalid CONNECTOR_TOKEN.");
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send("Server misconfigured: missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or OAUTH_REDIRECT_URI.");
    return;
  }

  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const state = randomBytes(32).toString("hex");

  res.setHeader(
    "Set-Cookie",
    `admob_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=600`,
  );

  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    scope: ADMOB_OAUTH_SCOPES,
    prompt: "consent",
    state,
  });

  res.redirect(302, authUrl);
}
