import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as url from "url";

const TOKEN_PATH = path.join(__dirname, "..", "secrets", "token.json");

const SCOPES = [
  "https://www.googleapis.com/auth/admob.readonly",
  "https://www.googleapis.com/auth/admob.report",
];

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

function loadClientCredentials(credentialsPath: string) {
  const content = fs.readFileSync(credentialsPath, "utf-8");
  const json = JSON.parse(content);
  const creds = json.installed || json.web;
  if (!creds) {
    throw new Error(
      "Invalid credentials file. Expected 'installed' or 'web' key."
    );
  }
  return creds;
}

function loadStoredTokens(): StoredTokens | null {
  try {
    const content = fs.readFileSync(TOKEN_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function saveTokens(tokens: StoredTokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

async function getAuthCodeViaLocalServer(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url || "", true);
      const code = parsed.query.code as string | undefined;
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>"
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

    setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out after 120 seconds"));
    }, 120000);
  });
}

export async function getAuthenticatedClient(credentialsPath: string) {
  const creds = loadClientCredentials(credentialsPath);

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:8089"
  );

  const storedTokens = loadStoredTokens();

  if (storedTokens) {
    oauth2Client.setCredentials(storedTokens);

    // Refresh if expired
    if (storedTokens.expiry_date && storedTokens.expiry_date < Date.now()) {
      console.error("Token expired, refreshing...");
      const { credentials } = await oauth2Client.refreshAccessToken();
      const updated: StoredTokens = {
        access_token: credentials.access_token!,
        refresh_token: credentials.refresh_token || storedTokens.refresh_token,
        token_type: credentials.token_type || "Bearer",
        expiry_date: credentials.expiry_date!,
      };
      saveTokens(updated);
      oauth2Client.setCredentials(updated);
    }

    return oauth2Client;
  }

  // No stored tokens - need to authorize
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  const code = await getAuthCodeViaLocalServer(authUrl);
  const { tokens } = await oauth2Client.getToken(code);

  const newTokens: StoredTokens = {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    token_type: tokens.token_type || "Bearer",
    expiry_date: tokens.expiry_date!,
  };

  saveTokens(newTokens);
  oauth2Client.setCredentials(newTokens);
  console.error("Authorization successful! Token saved.");

  return oauth2Client;
}
