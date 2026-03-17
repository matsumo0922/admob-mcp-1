#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRETS_DIR="$SCRIPT_DIR/secrets"

echo "=== AdMob MCP Server Setup ==="
echo

# 1. Ensure secrets directory exists
mkdir -p "$SECRETS_DIR"

# 2. Find and rename Google OAuth client secret file
if [ -f "$SECRETS_DIR/client_secret.json" ]; then
  echo "✓ client_secret.json already exists in secrets/"
else
  # Match the Google-downloaded filename pattern
  FOUND=$(find "$SECRETS_DIR" -maxdepth 1 -name 'client_secret_*.apps.googleusercontent.com.json' -print -quit)
  if [ -n "$FOUND" ]; then
    mv "$FOUND" "$SECRETS_DIR/client_secret.json"
    echo "✓ Renamed $(basename "$FOUND") → client_secret.json"
  else
    echo "ERROR: No client secret file found in secrets/"
    echo ""
    echo "  Before running setup, you must:"
    echo "  1. Go to https://console.cloud.google.com/apis/credentials"
    echo "  2. Create an OAuth client ID (Desktop app type)"
    echo "  3. Download the JSON file"
    echo "  4. Copy it into: $SECRETS_DIR"
    echo ""
    echo "  The file should be named something like:"
    echo "  client_secret_XXXXX.apps.googleusercontent.com.json"
    exit 1
  fi
fi

# 3. Install dependencies
echo
echo "Installing dependencies..."
npm install --prefix "$SCRIPT_DIR"

# 4. Build
echo
echo "Building..."
npm run build --prefix "$SCRIPT_DIR"

# 5. Register MCP server with Claude Code
echo
echo "Registering MCP server with Claude Code..."
claude mcp add admob \
  --scope user \
  -e ADMOB_CREDENTIALS_PATH="$SECRETS_DIR/client_secret.json" \
  -- node "$SCRIPT_DIR/dist/index.js"

echo
echo "=== Setup complete ==="
echo
echo "The 'admob' MCP server has been added to Claude Code."
echo "On first use, a browser window will open for Google OAuth authorization."
