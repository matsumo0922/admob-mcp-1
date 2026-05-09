import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 * Tells clients (Claude.ai) where the authorization server lives.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const issuer = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "admob-mcp.vercel.app"}`;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({
    resource: issuer,
    authorization_servers: [issuer],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  });
}
