import { google } from "googleapis";
import * as fs from "fs";
import * as http from "http";
import * as url from "url";
import type { StoredTokens, TokenStore } from "./token-store.js";

const ADMOB_SCOPES = [
  "https://www.googleapis.com/auth/admob.readonly",
  "https://www.googleapis.com/auth/admob.report",
];

const REAUTH_HINT =
  "Run `./setup.sh --reauth` in the admob-mcp directory to re-authorize, then restart the MCP server. " +
  "If this keeps happening, your Google Cloud OAuth consent screen may be in \"Testing\" mode — refresh tokens expire after 7 days in that mode.";

export class AdMobAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdMobAuthError";
  }
}

export function isInvalidGrantError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid_grant/i.test(msg);
}

export function wrapAuthError(err: unknown): Error {
  if (isInvalidGrantError(err)) {
    const original = err instanceof Error ? err.message : String(err);
    return new AdMobAuthError(
      `AdMob OAuth refresh token is invalid or expired (${original}). ${REAUTH_HINT}`
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export interface ClientCredentials {
  client_id: string;
  client_secret: string;
}

export function loadClientCredentialsFromFile(credentialsPath: string): ClientCredentials {
  const content = fs.readFileSync(credentialsPath, "utf-8");
  const json = JSON.parse(content);
  const creds = json.installed || json.web;
  if (!creds) {
    throw new Error("Invalid credentials file. Expected 'installed' or 'web' key.");
  }
  return { client_id: creds.client_id, client_secret: creds.client_secret };
}

/**
 * Returns an OAuth2 client with valid credentials, refreshing if needed.
 * Used by both stdio (FileTokenStore) and HTTP (KvTokenStore) modes.
 * Caller is responsible for ensuring tokens already exist in the store
 * (this function does NOT initiate an interactive OAuth flow).
 */
export async function getAuthenticatedClient(
  creds: ClientCredentials,
  store: TokenStore,
  redirectUri = "http://localhost:8089",
) {
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    redirectUri,
  );

  const stored = await store.load();
  if (!stored) {
    throw new AdMobAuthError(
      "No stored tokens found. Authorize first (local: ./setup.sh, Vercel: visit /api/setup).",
    );
  }

  const hasRequiredScopes =
    stored.scope && ADMOB_SCOPES.every((s) => stored.scope!.includes(s));
  if (!hasRequiredScopes) {
    throw new AdMobAuthError(
      `Stored token is missing required AdMob scopes. ${REAUTH_HINT}`,
    );
  }

  oauth2Client.setCredentials(stored);

  if (stored.expiry_date && stored.expiry_date < Date.now()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const updated: StoredTokens = {
        access_token: credentials.access_token!,
        refresh_token: credentials.refresh_token || stored.refresh_token,
        token_type: credentials.token_type || "Bearer",
        expiry_date: credentials.expiry_date!,
        scope: stored.scope,
      };
      await store.save(updated);
      oauth2Client.setCredentials(updated);
    } catch (err) {
      throw wrapAuthError(err);
    }
  }

  return oauth2Client;
}

/**
 * Interactive OAuth flow that opens a browser and waits for Google to
 * redirect to localhost:8089. Used only by the local CLI (authorize.ts).
 */
export async function authorizeViaLocalServer(
  creds: ClientCredentials,
  store: TokenStore,
): Promise<void> {
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:8089",
  );

  // Merge AdMob scopes with any previously granted scopes
  const mergedScopes = [...ADMOB_SCOPES];
  const existing = await store.load();
  if (existing?.scope) {
    for (const s of existing.scope.split(" ").filter(Boolean)) {
      if (!mergedScopes.includes(s)) mergedScopes.push(s);
    }
  }

  console.error("Requesting scopes:", mergedScopes.join(", "));

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: mergedScopes,
    prompt: "consent",
  });

  const code = await getAuthCodeViaLocalServer(authUrl);
  const { tokens } = await oauth2Client.getToken(code);

  const newTokens: StoredTokens = {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    token_type: tokens.token_type || "Bearer",
    expiry_date: tokens.expiry_date!,
    scope: tokens.scope || mergedScopes.join(" "),
  };

  await store.save(newTokens);
  console.error("Authorization successful! Token saved.");
}

async function getAuthCodeViaLocalServer(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url || "", true);
      const code = parsed.query.code as string | undefined;
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>",
        );
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Authorization failed</h1><p>No code received.</p>");
        server.close();
        reject(new Error("No authorization code received"));
      }
    });

    server.listen(8089, () => {
      console.error(`\n🔐 Open this URL in your browser to authorize:\n`);
      console.error(authUrl);
      console.error(`\nWaiting for authorization...\n`);
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out after 120 seconds"));
    }, 120000);

    server.on("close", () => clearTimeout(timeout));
  });
}

export const ADMOB_OAUTH_SCOPES = ADMOB_SCOPES;
