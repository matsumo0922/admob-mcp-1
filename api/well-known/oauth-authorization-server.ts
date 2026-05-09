import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 * Announces our OAuth endpoints so Claude.ai can drive the flow.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const issuer = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "admob-mcp.vercel.app"}`;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  });
}
