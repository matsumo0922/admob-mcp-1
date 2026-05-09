#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRETS_DIR="$SCRIPT_DIR/secrets"

REAUTH=false
MODE=""
for arg in "$@"; do
  case "$arg" in
    --reauth) REAUTH=true ;;
    --mode=local) MODE="local" ;;
    --mode=vercel) MODE="vercel" ;;
    --mode=both) MODE="both" ;;
    --help|-h)
      cat <<EOF
Usage: ./setup.sh [--mode=local|vercel|both] [--reauth]

  --mode=local   Local stdio mode for Claude Code on this machine (default if no flag and no prompt input).
  --mode=vercel  Vercel deployment for Claude.ai Connectors.
  --mode=both    Run both setups.
  --reauth       Force re-authorization (deletes secrets/token.json for local; prints /api/setup URL for Vercel).

Without --mode, you'll be prompted interactively.
EOF
      exit 0 ;;
  esac
done

echo "=== AdMob MCP Server Setup ==="
echo

if [ -z "$MODE" ]; then
  echo "Choose deployment mode:"
  echo "  [L] Local stdio (Claude Code on this machine)"
  echo "  [V] Vercel (Claude.ai Connector across devices)"
  echo "  [B] Both"
  echo -n "> "
  read -r choice
  case "$choice" in
    L|l) MODE="local" ;;
    V|v) MODE="vercel" ;;
    B|b) MODE="both" ;;
    *)
      echo "Invalid choice."
      exit 1 ;;
  esac
fi

run_local() {
  echo
  echo "--- Local stdio setup ---"

  mkdir -p "$SECRETS_DIR"

  if [ -f "$SECRETS_DIR/client_secret.json" ]; then
    echo "✓ client_secret.json already exists in secrets/"
  else
    FOUND=$(find "$SECRETS_DIR" -maxdepth 1 -name 'client_secret_*.apps.googleusercontent.com.json' -print -quit)
    if [ -n "$FOUND" ]; then
      mv "$FOUND" "$SECRETS_DIR/client_secret.json"
      echo "✓ Renamed $(basename "$FOUND") → client_secret.json"
    else
      echo "ERROR: No client secret file found in secrets/"
      echo
      echo "  Before running setup, you must:"
      echo "  1. Go to https://console.cloud.google.com/apis/credentials"
      echo "  2. Create an OAuth client ID (Desktop app type for local mode)"
      echo "  3. Download the JSON file"
      echo "  4. Copy it into: $SECRETS_DIR"
      exit 1
    fi
  fi

  echo
  echo "Installing dependencies..."
  npm install --prefix "$SCRIPT_DIR"

  echo
  echo "Building..."
  npm run build --prefix "$SCRIPT_DIR"

  if [ "$REAUTH" = true ] && [ -f "$SECRETS_DIR/token.json" ]; then
    echo
    echo "Removing existing token for re-authorization..."
    rm "$SECRETS_DIR/token.json"
  fi

  if [ -f "$SECRETS_DIR/token.json" ]; then
    echo
    echo "✓ Already authorized (secrets/token.json exists)"
    echo "  Run with --reauth to re-authorize with updated scopes."
  else
    echo
    echo "Authorizing with Google AdMob API..."
    echo "A browser window will open for you to grant access."
    echo
    ADMOB_CREDENTIALS_PATH="$SECRETS_DIR/client_secret.json" node "$SCRIPT_DIR/dist/src/authorize.js"
  fi

  echo
  echo "Registering MCP server with Claude Code..."
  claude mcp add admob \
    --scope user \
    -e ADMOB_CREDENTIALS_PATH="$SECRETS_DIR/client_secret.json" \
    -- node "$SCRIPT_DIR/dist/src/index.js"

  echo
  echo "✓ Local stdio setup complete."
}

run_vercel() {
  echo
  echo "--- Vercel setup ---"

  ENV_FILE="$SCRIPT_DIR/.env.local"
  if [ -f "$ENV_FILE" ] && grep -q '^CONNECTOR_TOKEN=' "$ENV_FILE"; then
    EXISTING_TOKEN=$(grep '^CONNECTOR_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
    if [ "$REAUTH" = true ]; then
      echo "Re-auth requested. To re-authorize Google credentials, visit:"
      echo "  https://<your-deploy>.vercel.app/api/setup"
      echo "and submit your existing CONNECTOR_TOKEN. The /api/oauth/callback handler"
      echo "will overwrite the stored token in Vercel KV."
    else
      echo "✓ .env.local already has CONNECTOR_TOKEN: ${EXISTING_TOKEN:0:8}…"
    fi
  else
    NEW_TOKEN=$(openssl rand -hex 32)
    if [ ! -f "$ENV_FILE" ]; then
      cp "$SCRIPT_DIR/.env.example" "$ENV_FILE" 2>/dev/null || touch "$ENV_FILE"
    fi
    if grep -q '^CONNECTOR_TOKEN=' "$ENV_FILE"; then
      sed -i.bak "s/^CONNECTOR_TOKEN=.*/CONNECTOR_TOKEN=$NEW_TOKEN/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
      echo "CONNECTOR_TOKEN=$NEW_TOKEN" >> "$ENV_FILE"
    fi
    echo "✓ Generated CONNECTOR_TOKEN and wrote it to .env.local"
    echo "  Token: $NEW_TOKEN"
    echo
    echo "  IMPORTANT: copy this token into Vercel project env vars when prompted."
  fi

  echo
  echo "Next steps (full guide: docs/VERCEL.md):"
  echo
  echo "  1. Click the Deploy-to-Vercel button in README.md (or run 'vercel deploy' from this directory)."
  echo "  2. In Vercel dashboard: provision Vercel KV (Upstash Redis) and link it to the project."
  echo "  3. Set env vars in Vercel: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI, CONNECTOR_TOKEN"
  echo "     - Create the Google OAuth client at https://console.cloud.google.com/apis/credentials"
  echo "       (Web application; authorized redirect URI = https://<deploy>.vercel.app/api/oauth/callback)"
  echo "  4. Visit https://<deploy>.vercel.app/api/setup, paste CONNECTOR_TOKEN, click Authorize."
  echo "  5. In Claude.ai → Settings → Connectors → Add custom connector:"
  echo "       URL = https://<deploy>.vercel.app/api/mcp"
  echo "       Bearer = CONNECTOR_TOKEN"
  echo
  echo "✓ Vercel setup notes printed."
}

case "$MODE" in
  local) run_local ;;
  vercel) run_vercel ;;
  both)
    run_local
    run_vercel ;;
esac

echo
echo "=== Setup complete ==="
