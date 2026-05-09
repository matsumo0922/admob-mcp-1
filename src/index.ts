import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "path";
import {
  getAuthenticatedClient,
  loadClientCredentialsFromFile,
} from "./auth.js";
import { AdMobClient } from "./admob-client.js";
import { FileTokenStore } from "./token-store.js";
import { registerTools } from "./tools.js";

const CREDENTIALS_PATH =
  process.env.ADMOB_CREDENTIALS_PATH ||
  path.join(__dirname, "..", "secrets", "client_secret.json");

const TOKEN_PATH = path.join(__dirname, "..", "secrets", "token.json");

let admobClient: AdMobClient | null = null;

async function getClient(): Promise<AdMobClient> {
  if (!admobClient) {
    const creds = loadClientCredentialsFromFile(CREDENTIALS_PATH);
    const store = new FileTokenStore(TOKEN_PATH);
    const auth = await getAuthenticatedClient(creds, store);
    admobClient = new AdMobClient(auth);
  }
  return admobClient;
}

const server = new McpServer({
  name: "admob-mcp",
  version: "1.0.0",
});

registerTools(server, getClient);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AdMob MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
