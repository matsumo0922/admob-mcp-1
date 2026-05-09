import * as path from "path";
import { authorizeViaLocalServer, loadClientCredentialsFromFile } from "./auth.js";
import { FileTokenStore } from "./token-store.js";

// __dirname resolves to dist/src/ at runtime (compiled output), so we go up
// two levels to reach the repo root and then into secrets/.
const credentialsPath =
  process.env.ADMOB_CREDENTIALS_PATH ||
  path.join(__dirname, "..", "..", "secrets", "client_secret.json");

const tokenPath = path.join(__dirname, "..", "..", "secrets", "token.json");

async function main() {
  console.log("Authorizing with Google AdMob API...");
  const creds = loadClientCredentialsFromFile(credentialsPath);
  const store = new FileTokenStore(tokenPath);
  await authorizeViaLocalServer(creds, store);
  console.log("Authorization complete! Token saved to secrets/token.json");
  process.exit(0);
}

main().catch((err) => {
  console.error("Authorization failed:", err.message);
  process.exit(1);
});
