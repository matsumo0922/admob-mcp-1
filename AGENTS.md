# AdMob MCP Server

Local MCP server that connects Claude to the Google AdMob API via OAuth 2.0.

## Build & Run

```bash
npm install
npm run build           # tsc → dist/ (mirrors src/, api/, tests/)
npm test                # vitest unit tests
npm run start           # run stdio server on stdio
npm run dev:vercel      # vercel dev (HTTP mode, requires .env.local)
npm run deploy          # vercel deploy --prod
./setup.sh              # interactive: pick local / vercel / both
./setup.sh --mode=local # non-interactive
./setup.sh --reauth     # re-authorize (mode-aware)
```

## Project Layout

- `src/index.ts` — stdio MCP entry point. Calls `registerTools(server, getClient)` with `FileTokenStore`.
- `src/tools.ts` — all tool definitions (6 core + 10 reporting + 20 optimization). Exports `registerTools(server, getClient)`.
- `src/auth.ts` — OAuth helpers. `getAuthenticatedClient(creds, store)` is the headless refresh path used by both modes; `authorizeViaLocalServer(creds, store)` is the interactive CLI flow.
- `src/authorize.ts` — Standalone CLI script for OAuth authorization (run by `setup.sh` for local mode).
- `src/admob-client.ts` — Thin REST client over `https://admob.googleapis.com/v1`.
- `src/helpers.ts` — Date math, report row parsing, table formatting, period-over-period change utils.
- `src/token-store.ts` — `TokenStore` interface, `FileTokenStore` (local), `KvTokenStore` (Vercel KV).
- `src/oauth-store.ts` — KV-backed storage for the connector OAuth flow: short-lived auth codes (`oauth:authcode:<code>`, 10-min TTL) and long-lived access tokens (`oauth:token:<token>`).
- `src/http-auth.ts` — `checkBearer` (sync, against `CONNECTOR_TOKEN`) used by `/oauth/authorize` and `/api/setup`; `checkBearerAsync` (also accepts KV-issued access tokens) used by `/api/mcp`.
- `api/mcp.ts` — Vercel function: Streamable HTTP MCP endpoint. Bearer-gated. Returns `WWW-Authenticate: Bearer realm="admob-mcp", resource_metadata="…"` on 401 per the MCP authorization spec.
- `api/setup.ts` — Vercel function: GET form + POST handler that initiates the **Google ↔ server** OAuth flow. Server's grant on AdMob.
- `api/oauth/callback.ts` — Vercel function: Google's redirect URI; stores tokens in KV.
- `api/oauth/authorize.ts`, `api/oauth/token.ts`, `api/oauth/register.ts` — Vercel functions implementing the **Claude.ai ↔ server** OAuth 2.1 flow with PKCE (S256) and Dynamic Client Registration. Required because Claude.ai's connector UI doesn't accept static bearer tokens — it negotiates its own access token.
- `api/well-known/oauth-authorization-server.ts`, `api/well-known/oauth-protected-resource.ts` — RFC 8414 / RFC 9728 metadata endpoints; reached at root paths (`/.well-known/...`) via `vercel.json` rewrites so Claude.ai's discovery works.
- `vercel.json` — Vercel function runtime + per-function timeouts + rewrites mapping `/.well-known/*` and `/oauth/*` to the `api/` directory.
- `.env.example` — Template for Vercel mode env vars.
- `secrets/` — Git-ignored. Local-mode `client_secret.json` and `token.json` live here.
- `setup.sh` — Interactive setup: pick `[L]ocal` / `[V]ercel` / `[B]oth`. Supports `--mode=` and `--reauth`.
- `docs/VERCEL.md` — Forker-facing deploy guide for the Connector path.
- `tests/` — vitest unit tests (`token-store.test.ts`, `http-auth.test.ts`).
- `CLAUDE.md` — Symlink to this file.

## Tool Categories

**Core API** (6): `list_accounts`, `get_account`, `list_ad_units`, `list_apps`, `generate_network_report`, `generate_mediation_report`

**Reporting** (10): `revenue_trend`, `ad_unit_performance`, `country_breakdown`, `format_comparison`, `platform_comparison`, `fill_rate_analysis`, `mediation_ad_source_performance`, `wow_revenue`, `top_apps`, `ecpm_trend`

**Revenue Optimization** (20): `revenue_drop_diagnosis`, `serving_restriction_impact`, `app_version_impact`, `sdk_version_check`, `month_over_month`, `high_impression_low_ctr`, `os_version_performance`, `mediation_group_analysis`, `country_ecpm_opportunity`, `format_by_country`, `revenue_pacing`, `best_worst_days`, `weekday_vs_weekend`, `platform_format_matrix`, `revenue_concentration`, `ad_source_trend`, `app_deep_dive`, `anomaly_detection`, `ad_source_instance_comparison`, `yoy_comparison`

## Key Patterns

- All tools use `z` (zod) schemas for input validation
- Report tools return pre-formatted ASCII tables with earnings auto-converted from micros to dollars
- High-level tools have sensible defaults — only `account_id` is required; `days`, `top_n`, etc. are optional
- The AdMob API returns streaming responses (array of header/row/footer objects); `parseReportRows()` in helpers.ts normalizes these into flat `Record<string, string>` arrays
- OAuth tokens are stored in `secrets/token.json` and auto-refreshed when expired
- Optimization tools like `revenue_drop_diagnosis` make parallel API calls to compare periods across multiple dimensions
- The `setup.sh` script auto-detects `client_secret_*.apps.googleusercontent.com.json` files in `secrets/` and renames to `client_secret.json`
- Token storage is abstracted behind `TokenStore` (`FileTokenStore` for local, `KvTokenStore` for Vercel). `auth.ts` doesn't couple token storage to any backend — it takes a `TokenStore` and never touches `token.json` or KV directly. (`auth.ts` does still read `client_secret.json` via `loadClientCredentialsFromFile`.)
- The HTTP MCP endpoint (`api/mcp.ts`) is stateless — each request constructs its own `McpServer` and `StreamableHTTPServerTransport`.
- The deployment runs **two OAuth flows** gated by the same `CONNECTOR_TOKEN`: (1) Google ↔ server (gives the server access to AdMob, run once via `/api/setup`); (2) Claude.ai ↔ server (gives Claude.ai access to the server, run once per device-pairing via `/oauth/authorize`).
- `CONNECTOR_TOKEN` gates `/api/setup`, `/oauth/authorize`, and is also accepted as a direct bearer for `/api/mcp` (useful for curl-testing). Comparison is timing-safe.
- KV-issued access tokens (random 32-byte hex, stored under `oauth:token:<token>`) are validated by `checkBearerAsync`. They are long-lived; rotating `CONNECTOR_TOKEN` doesn't revoke them — operators must delete the KV keys to force re-pairing.
- The Google OAuth `state` cookie is `HttpOnly Secure SameSite=Lax` scoped to `/api/oauth` — covers the callback at `/api/oauth/callback` without leaking elsewhere.
- The connector OAuth flow uses PKCE (S256 only). `client_id` issued by `/oauth/register` is ephemeral (not stored).

## Contribution Rules

- When adding a new tool, always update the tools table in `README.md` to document it with a prompt example.
- Also update the tool count and tool list in this file (`AGENTS.md`).
- When adding a new env var, document it in `.env.example` *and* `docs/VERCEL.md`.
- Don't put `CONNECTOR_TOKEN` (or any access token) in URLs. Both `/api/setup` and `/oauth/authorize` use POST forms deliberately; preserve that pattern.
- Don't introduce per-route OAuth scopes or per-user identity without re-thinking the single-tenant model — every change cascades into Claude.ai's discovery flow.

## Secrets

Never commit files into `secrets/` beyond `.gitkeep`. The `.gitignore` is configured to ignore `secrets/*` but allow `secrets/.gitkeep`. This directory holds OAuth credentials and tokens.
