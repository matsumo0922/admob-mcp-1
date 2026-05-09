import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getAuthenticatedClient } from "../src/auth.js";
import { AdMobClient } from "../src/admob-client.js";
import { KvTokenStore } from "../src/token-store.js";
import { registerTools } from "../src/tools.js";
import { checkBearerAsync } from "../src/http-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await checkBearerAsync(req.headers["authorization"]))) {
    const issuer = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "admob-mcp.vercel.app"}`;
    res.setHeader(
      "WWW-Authenticate",
      `Bearer realm="admob-mcp", resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "Server misconfigured: GOOGLE_CLIENT_ID/SECRET missing" });
    return;
  }

  const store = new KvTokenStore();
  let admobClient: AdMobClient | null = null;
  const getClient = async (): Promise<AdMobClient> => {
    if (!admobClient) {
      const auth = await getAuthenticatedClient(
        { client_id: clientId, client_secret: clientSecret },
        store,
      );
      admobClient = new AdMobClient(auth);
    }
    return admobClient;
  };

  const server = new McpServer({ name: "admob-mcp", version: "1.0.0" });
  registerTools(server, getClient);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — each request stands alone
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
