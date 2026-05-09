import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "crypto";

/**
 * RFC 7591 — Dynamic Client Registration.
 *
 * Single-tenant deployment: we don't track per-client metadata. Any
 * caller (i.e. Claude.ai) gets a fresh client_id; we don't store it.
 * The actual access control happens at /oauth/authorize where the user
 * has to paste the CONNECTOR_TOKEN. The client_id is just a handle.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const clientId = `mcp_${randomBytes(16).toString("hex")}`;
  const issuedAt = Math.floor(Date.now() / 1000);

  // Reflect any redirect_uris the client sent. Required field per RFC 7591.
  const body = (req.body ?? {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

  res.status(201).json({
    client_id: clientId,
    client_id_issued_at: issuedAt,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}
