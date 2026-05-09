import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "crypto";
import { checkBearer } from "../../src/http-auth.js";
import { saveAuthCode } from "../../src/oauth-store.js";

/**
 * OAuth 2.1 authorization endpoint.
 *
 * GET: renders an HTML form. Required query params:
 *   - client_id, redirect_uri, response_type=code, state,
 *     code_challenge, code_challenge_method=S256
 *
 * POST: form-encoded body containing all the GET params plus a `token`
 *   field carrying the user's CONNECTOR_TOKEN. We validate token,
 *   issue an auth code, and 302 to the redirect_uri.
 *
 * The user pastes CONNECTOR_TOKEN here (same UX as /api/setup, but for
 * the connector itself rather than for the underlying Google OAuth).
 */

interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
}

function readParams(source: Record<string, unknown>): Partial<AuthorizeParams> {
  const get = (k: string) => {
    const v = source[k];
    return typeof v === "string" ? v : undefined;
  };
  return {
    client_id: get("client_id"),
    redirect_uri: get("redirect_uri"),
    response_type: get("response_type"),
    state: get("state"),
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method"),
    scope: get("scope"),
  };
}

function validateParams(p: Partial<AuthorizeParams>): { ok: true; params: AuthorizeParams } | { ok: false; reason: string } {
  if (!p.client_id) return { ok: false, reason: "Missing client_id." };
  if (!p.redirect_uri) return { ok: false, reason: "Missing redirect_uri." };
  if (p.response_type !== "code") return { ok: false, reason: "response_type must be 'code'." };
  if (!p.state) return { ok: false, reason: "Missing state." };
  if (!p.code_challenge) return { ok: false, reason: "Missing code_challenge (PKCE required)." };
  if (p.code_challenge_method !== "S256") return { ok: false, reason: "code_challenge_method must be 'S256'." };

  try {
    const u = new URL(p.redirect_uri);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      return { ok: false, reason: "redirect_uri must use https (or localhost)." };
    }
  } catch {
    return { ok: false, reason: "redirect_uri is not a valid URL." };
  }

  return {
    ok: true,
    params: {
      client_id: p.client_id,
      redirect_uri: p.redirect_uri,
      response_type: p.response_type,
      state: p.state,
      code_challenge: p.code_challenge,
      code_challenge_method: p.code_challenge_method,
      scope: p.scope,
    },
  };
}

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

function renderForm(params: AuthorizeParams, errorMessage?: string): string {
  const hidden = (name: string, value: string | undefined) =>
    value === undefined
      ? ""
      : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  const errorBlock = errorMessage
    ? `<p style="color:#b00020">${escapeHtml(errorMessage)}</p>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AdMob MCP — Authorize Connector</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px}
input{width:100%;padding:8px;font-size:14px;margin:8px 0;box-sizing:border-box}
button{padding:10px 16px;font-size:14px}
small{color:#555}</style></head>
<body>
<h1>Authorize Claude connector</h1>
<p>Claude is requesting access to your AdMob MCP server.
Paste your <code>CONNECTOR_TOKEN</code> (from Vercel env vars) and click Authorize.</p>
${errorBlock}
<form method="POST" action="/oauth/authorize">
  ${hidden("client_id", params.client_id)}
  ${hidden("redirect_uri", params.redirect_uri)}
  ${hidden("response_type", params.response_type)}
  ${hidden("state", params.state)}
  ${hidden("code_challenge", params.code_challenge)}
  ${hidden("code_challenge_method", params.code_challenge_method)}
  ${hidden("scope", params.scope)}
  <input type="password" name="token" placeholder="CONNECTOR_TOKEN" autocomplete="off" required>
  <button type="submit">Authorize</button>
</form>
<p><small>You only do this once per device that you connect to this server.</small></p>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const isPost = req.method === "POST";
  const source: Record<string, unknown> = isPost
    ? (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {})
    : (req.query as Record<string, unknown>);

  const partial = readParams(source);
  const validated = validateParams(partial);

  if (!validated.ok) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(`<h1>Invalid authorization request</h1><p>${escapeHtml(validated.reason)}</p>`);
    return;
  }
  const params = validated.params;

  if (!isPost) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(renderForm(params));
    return;
  }

  const submitted = typeof source.token === "string" ? source.token : undefined;
  if (!checkBearer(submitted ? `Bearer ${submitted}` : undefined)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(401).send(renderForm(params, "Invalid CONNECTOR_TOKEN. Check the value in Vercel env vars."));
    return;
  }

  const code = randomBytes(32).toString("hex");
  await saveAuthCode(code, {
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: "S256",
  });

  const redirect = new URL(params.redirect_uri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", params.state);
  res.redirect(302, redirect.toString());
}
