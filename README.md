# AdMob MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that connects Claude to the [Google AdMob API](https://developers.google.com/admob/api), giving you a conversational interface to your ad revenue data.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwillhou%2Fadmob-mcp&env=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,CONNECTOR_TOKEN,OAUTH_REDIRECT_URI&envDescription=See%20docs%2FVERCEL.md%20for%20how%20to%20obtain%20each%20value&envLink=https%3A%2F%2Fgithub.com%2Fwillhou%2Fadmob-mcp%2Fblob%2Fmain%2Fdocs%2FVERCEL.md)

Two ways to use this server:
- **Local stdio (Claude Code on one machine):** run `./setup.sh` and pick **L**.
- **Vercel + Claude.ai Connector (multi-device):** click the badge above, then follow [docs/VERCEL.md](docs/VERCEL.md). Or run `./setup.sh` and pick **V**.

## Prerequisites

- Node.js 18+
- A Google Cloud project with the **AdMob API** enabled
- OAuth 2.0 client credentials — **Desktop app** type for local mode, **Web application** type for Vercel mode (see [docs/VERCEL.md](docs/VERCEL.md) for the Vercel-specific setup).

## Setup

### 1. Get Google OAuth credentials

1. Go to the [Google API Console](https://console.cloud.google.com/apis/credentials)
2. Create or select a project
3. Enable the **AdMob API** in the API Library
4. Go to **Credentials** > **Create Credentials** > **OAuth client ID**
5. Select **Desktop app**, name it, and click **Create**
6. Click **Download JSON** to download the client secret file
7. Copy the downloaded file into the `secrets/` folder in this project

### 2. Install and configure

```bash
cd admob-mcp
./setup.sh
```

The setup script will:
- Find and rename the Google OAuth JSON to `secrets/client_secret.json`
- Install dependencies and build
- Open a browser for Google OAuth authorization (token saved to `secrets/token.json`)
- Register the MCP server with Claude Code

To re-authorize with updated scopes (e.g. after adding another Google MCP):

```bash
./setup.sh --reauth
```

> **Note:** If your Google Cloud project's OAuth consent screen has not been published (i.e. it is still in "Testing" status), you will see an authorization error. To fix this, either publish the app or add your Google account as a test user under **OAuth consent screen** > **Audience** in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials/consent).

## Manual configuration

If you prefer not to use `setup.sh`, add this to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "admob": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/admob-mcp/dist/src/index.js"],
      "env": {
        "ADMOB_CREDENTIALS_PATH": "/absolute/path/to/admob-mcp/secrets/client_secret.json"
      }
    }
  }
}
```

## Connector setup (Vercel)

Use this if you want the AdMob tools available in Claude.ai on every device, not just Claude Code on your laptop.

1. Fork the repo.
2. Click **Deploy with Vercel** above.
3. Provision **Upstash Redis** in the Vercel Storage tab — it auto-injects the `KV_*` env vars our code uses. (Vercel deprecated standalone "Vercel KV"; Upstash is the same backend.)
4. Create a Google Cloud OAuth client (Web app). Authorized redirect URI = `https://<your-deploy>.vercel.app/api/oauth/callback`.
5. Set env vars in Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `CONNECTOR_TOKEN` (generate with `openssl rand -hex 32`). Watch for stray whitespace.
6. Visit `https://<your-deploy>.vercel.app/api/setup`, paste `CONNECTOR_TOKEN`, click Authorize, and complete Google sign-in. This authorizes the *server* to read AdMob data on your behalf.
7. In Claude.ai → **Settings → Connectors → Add custom connector**: paste `https://<your-deploy>.vercel.app/api/mcp` as the URL, leave OAuth Client ID and Secret blank, click **Add**, then click **Connect**. A browser tab opens at `/oauth/authorize` — paste the same `CONNECTOR_TOKEN` once. Claude.ai handles the rest.

Two OAuth flows are gated by the same `CONNECTOR_TOKEN`: Google ↔ server (step 6) and Claude.ai ↔ server (step 7). Full walkthrough including troubleshooting: [docs/VERCEL.md](docs/VERCEL.md).

## Usage

Just ask Claude a question about your AdMob data in natural language. On first use, Claude will automatically call `list_accounts` to discover your AdMob accounts and ask which one you want to work with. After that, it will use the appropriate tools to answer your questions.

## Tools

### Core API tools

| Tool | Description |
|------|-------------|
| `list_accounts` | List your AdMob publisher accounts |
| `get_account` | Get details for a specific account |
| `list_ad_units` | List ad units with pagination |
| `list_apps` | List apps with pagination |
| `generate_network_report` | Generate a custom network report with full control over dimensions, metrics, filters, and sorting |
| `generate_mediation_report` | Generate a custom mediation report with full control over dimensions, metrics, filters, and sorting |

### Reporting tools

| Tool | Prompt example |
|------|----------------|
| `revenue_trend` | "Show my revenue trend for the last 30 days" |
| `ad_unit_performance` | "Which ad units are underperforming?" |
| `country_breakdown` | "Break down my earnings by country" |
| `format_comparison` | "Compare performance across ad formats" |
| `platform_comparison` | "How is iOS vs Android performing?" |
| `fill_rate_analysis` | "What's my fill rate and where am I losing money?" |
| `mediation_ad_source_performance` | "Which mediation ad sources perform best?" |
| `wow_revenue` | "Show week-over-week revenue changes" |
| `top_apps` | "Which apps are my top earners?" |
| `ecpm_trend` | "Show my eCPM trends by ad unit over time" |

### Revenue optimization tools

| Tool | Prompt example |
|------|----------------|
| `revenue_drop_diagnosis` | "My revenue dropped this week, what happened?" |
| `serving_restriction_impact` | "How much revenue am I losing to privacy restrictions?" |
| `app_version_impact` | "Did my latest app update affect ad revenue?" |
| `sdk_version_check` | "Are users on old SDK versions seeing lower eCPM?" |
| `month_over_month` | "How is this month comparing to last month?" |
| `high_impression_low_ctr` | "Which ad placements should I optimize?" |
| `os_version_performance` | "Are certain OS versions hurting my ad revenue?" |
| `mediation_group_analysis` | "Which mediation groups need optimization?" |
| `country_ecpm_opportunity` | "Where can I improve eCPM by country?" |
| `format_by_country` | "Which ad formats work best in which countries?" |
| `revenue_pacing` | "Am I on track to hit last month's revenue?" |
| `best_worst_days` | "What were my best and worst days this month?" |
| `weekday_vs_weekend` | "Do I earn more on weekdays or weekends?" |
| `platform_format_matrix` | "Which formats perform best on each platform?" |
| `revenue_concentration` | "How diversified is my revenue?" |
| `ad_source_trend` | "How are my mediation sources trending?" |
| `app_deep_dive` | "Give me a full breakdown for my top app" |
| `anomaly_detection` | "Flag any unusual days in the last 30 days" |
| `ad_source_instance_comparison` | "Compare ad instances within each mediation source" |
| `yoy_comparison` | "How does this month compare to the same month last year?" |

## Project structure

- `src/index.ts` — stdio entry point (Claude Code).
- `src/tools.ts` — all 36 tool definitions; `registerTools(server, getClient)`.
- `src/auth.ts` — Google OAuth helpers (`getAuthenticatedClient`, `authorizeViaLocalServer`).
- `src/token-store.ts` — `TokenStore` interface + `FileTokenStore` (local) + `KvTokenStore` (Vercel KV).
- `src/oauth-store.ts` — KV-backed storage for the connector OAuth flow (auth codes + access tokens).
- `src/http-auth.ts` — Timing-safe bearer check for HTTP endpoints (sync against `CONNECTOR_TOKEN`, async against KV-issued access tokens).
- `src/admob-client.ts`, `src/helpers.ts` — REST client and report-formatting utilities.
- `api/mcp.ts` — Vercel function: HTTP MCP endpoint (Streamable HTTP, bearer-gated, emits `WWW-Authenticate` on 401).
- `api/setup.ts` — Vercel function: form that initiates the **Google ↔ server** OAuth flow.
- `api/oauth/callback.ts` — Vercel function: Google's redirect URI; stores tokens in KV.
- `api/oauth/authorize.ts`, `api/oauth/token.ts`, `api/oauth/register.ts` — Vercel functions implementing the **Claude.ai ↔ server** OAuth 2.1 flow with PKCE and Dynamic Client Registration.
- `api/well-known/oauth-authorization-server.ts`, `api/well-known/oauth-protected-resource.ts` — RFC 8414 / RFC 9728 metadata so Claude.ai can discover the OAuth endpoints.
- `setup.sh` — Interactive setup script ([L]ocal / [V]ercel / [B]oth).
- `docs/VERCEL.md` — Forker deployment guide.
- `AGENTS.md` — Canonical project notes (CLAUDE.md is a symlink to it).

## Development

```bash
npm run build     # Compile TypeScript
npm run start     # Run the server directly (stdio)
```
