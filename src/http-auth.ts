import { timingSafeEqual } from "crypto";

/**
 * Validates an Authorization header against CONNECTOR_TOKEN env var.
 * Uses constant-time comparison. Returns false if the env var is unset
 * (refuse-by-default — never authorize without an explicit secret).
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
