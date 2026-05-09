import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "path";
import { getAuthenticatedClient } from "./auth.js";
import { AdMobClient } from "./admob-client.js";

const CREDENTIALS_PATH =
  process.env.ADMOB_CREDENTIALS_PATH ||
  path.join(__dirname, "..", "secrets", "client_secret.json");

let admobClient: AdMobClient | null = null;

async function getClient(): Promise<AdMobClient> {
  if (!admobClient) {
    const auth = await getAuthenticatedClient(CREDENTIALS_PATH);
    admobClient = new AdMobClient(auth);
  }
  return admobClient;
}

const server = new McpServer({
  name: "admob-mcp",
  version: "1.0.0",
});

// Tool registrations are in src/tools.ts (registerTools).
// TODO (Task 7): call registerTools(server, getClient) here.

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AdMob MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
