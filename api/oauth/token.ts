import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomBytes } from "crypto";
import { consumeAuthCode, saveAccessToken } from "../../src/oauth-store.js";

/**
 * OAuth 2.1 token endpoint.
 *
 * Accepts: POST application/x-www-form-urlencoded with
 *   - grant_type=authorization_code
 *   - code=<auth code from /oauth/authorize>
 *   - redirect_uri=<must match what was used at /authorize>
 *   - client_id
 *   - code_verifier=<PKCE verifier>
 *
 * Returns JSON with access_token + token_type=Bearer.
 *
 * The auth code is single-use (consumeAuthCode deletes it after read).
 * PKCE is required (S256 only).
 */

function err(res: VercelResponse, status: number, code: string, description?: string) {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.json(description ? { error: code, error_description: description } : { error: code });
}

function pkceMatches(verifier: string, challenge: string): boolean {
  // S256: base64url(SHA256(verifier))
  const hash = createHash("sha256").update(verifier).digest();
  const b64 = hash.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return b64 === challenge;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    err(res, 405, "invalid_request", "Method not allowed");
    return;
  }

  const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const get = (k: string): string | undefined => (typeof body[k] === "string" ? (body[k] as string) : undefined);

  const grantType = get("grant_type");
  if (grantType !== "authorization_code") {
    err(res, 400, "unsupported_grant_type");
    return;
  }

  const code = get("code");
  const redirectUri = get("redirect_uri");
  const clientId = get("client_id");
  const codeVerifier = get("code_verifier");

  if (!code || !redirectUri || !clientId || !codeVerifier) {
    err(res, 400, "invalid_request", "Missing required parameter.");
    return;
  }

  const record = await consumeAuthCode(code);
  if (!record) {
    err(res, 400, "invalid_grant", "Authorization code is invalid, expired, or already used.");
    return;
  }

  if (record.redirect_uri !== redirectUri) {
    err(res, 400, "invalid_grant", "redirect_uri does not match the original authorization request.");
    return;
  }

  if (record.client_id !== clientId) {
    err(res, 400, "invalid_grant", "client_id does not match the original authorization request.");
    return;
  }

  if (!pkceMatches(codeVerifier, record.code_challenge)) {
    err(res, 400, "invalid_grant", "PKCE code_verifier does not match code_challenge.");
    return;
  }

  const accessToken = randomBytes(32).toString("hex");
  await saveAccessToken(accessToken);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.status(200).json({
    access_token: accessToken,
    token_type: "Bearer",
    scope: "mcp",
  });
}
