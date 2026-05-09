import { timingSafeEqual } from "crypto";
import { isAccessTokenValid } from "./oauth-store.js";

/**
 * Synchronous bearer check against CONNECTOR_TOKEN env var.
 * Used by /oauth/authorize where the user pastes the connector token directly,
 * and as a backstop for /api/mcp (allows direct API testing without going
 * through the OAuth flow).
 *
 * Returns false if CONNECTOR_TOKEN is unset (refuse-by-default).
 */
export function checkBearer(authHeader: string | undefined): boolean {
  const expected = process.env.CONNECTOR_TOKEN;
  if (!expected) return false;
  if (!authHeader) return false;

  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match) return false;
  const provided = match[1];

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Async bearer check used by /api/mcp. Accepts either:
 *   1. The static CONNECTOR_TOKEN (timing-safe), or
 *   2. An OAuth-issued access token stored in KV (issued by /oauth/token).
 *
 * Returns false on missing/malformed header or invalid token.
 */
export async function checkBearerAsync(authHeader: string | undefined): Promise<boolean> {
  if (checkBearer(authHeader)) return true;

  if (!authHeader) return false;
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match) return false;
  const provided = match[1];

  return isAccessTokenValid(provided);
}
