/**
 * KV-backed storage for OAuth authorization codes and access tokens.
 *
 * Single-tenant design: any access token issued by /oauth/token is valid
 * for /api/mcp. We don't track per-user identity because the deployment
 * itself is single-user.
 */

const AUTH_CODE_PREFIX = "oauth:authcode:";
const ACCESS_TOKEN_PREFIX = "oauth:token:";

const AUTH_CODE_TTL_SECONDS = 600; // 10 minutes
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year (effectively long-lived)

export interface AuthCodeRecord {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
}

export interface AccessTokenRecord {
  issued_at_ms: number;
}

async function getKv() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

export async function saveAuthCode(code: string, record: AuthCodeRecord): Promise<void> {
  const kv = await getKv();
  await kv.set(AUTH_CODE_PREFIX + code, record, { ex: AUTH_CODE_TTL_SECONDS });
}

export async function consumeAuthCode(code: string): Promise<AuthCodeRecord | null> {
  const kv = await getKv();
  const key = AUTH_CODE_PREFIX + code;
  const record = await kv.get<AuthCodeRecord>(key);
  if (!record) return null;
  await kv.del(key);
  return record;
}

export async function saveAccessToken(token: string): Promise<void> {
  const kv = await getKv();
  const record: AccessTokenRecord = { issued_at_ms: Date.now() };
  await kv.set(ACCESS_TOKEN_PREFIX + token, record, { ex: ACCESS_TOKEN_TTL_SECONDS });
}

export async function isAccessTokenValid(token: string): Promise<boolean> {
  const kv = await getKv();
  const record = await kv.get<AccessTokenRecord>(ACCESS_TOKEN_PREFIX + token);
  return record !== null;
}
