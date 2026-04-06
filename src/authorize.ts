import * as path from "path";
import { getAuthenticatedClient } from "./auth.js";

const credentialsPath =
  process.env.ADMOB_CREDENTIALS_PATH ||
  path.join(__dirname, "..", "secrets", "client_secret.json");

async function main() {
  console.log("Authorizing with Google AdMob API...");
  await getAuthenticatedClient(credentialsPath);
  console.log("Authorization complete! Token saved to secrets/token.json");
  process.exit(0);
}

main().catch((err) => {
  console.error("Authorization failed:", err.message);
  process.exit(1);
});
