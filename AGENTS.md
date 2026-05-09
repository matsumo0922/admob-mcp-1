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
- `src/http-auth.ts` — Timing-safe bearer check against `CONNECTOR_TOKEN`.
- `api/mcp.ts` — Vercel function: Streamable HTTP MCP endpoint. Bearer-gated.
- `api/setup.ts` — Vercel function: GET form + POST handler that initiates Google OAuth.
- `api/oauth/callback.ts` — Vercel function: Google redirect URI; stores tokens in KV.
- `vercel.json` — Vercel function runtime + per-function timeouts.
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
- `CONNECTOR_TOKEN` gates `api/mcp.ts` and `api/setup.ts`. Comparison is timing-safe.
- OAuth state is stored in an `HttpOnly Secure SameSite=Lax` cookie scoped to `/api/oauth`.

## Contribution Rules

- When adding a new tool, always update the tools table in `README.md` to document it with a prompt example.
- Also update the tool count and tool list in this file (`AGENTS.md`).
- When adding a new env var, document it in `.env.example` *and* `docs/VERCEL.md`.
- Don't put `CONNECTOR_TOKEN` in URLs. The `/api/setup` flow uses a POST form deliberately.

## Secrets

Never commit files into `secrets/` beyond `.gitkeep`. The `.gitignore` is configured to ignore `secrets/*` but allow `secrets/.gitkeep`. This directory holds OAuth credentials and tokens.
