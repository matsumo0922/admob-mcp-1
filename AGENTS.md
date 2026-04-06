# AdMob MCP Server

Local MCP server that connects Claude to the Google AdMob API via OAuth 2.0.

## Build & Run

```bash
npm install
npm run build      # tsc → dist/
npm run start      # run server on stdio
./setup.sh         # full setup: rename creds, build, register with Claude Code
```

## Project Layout

- `src/index.ts` — MCP server entry point, all tool definitions (6 core + 10 reporting + 20 optimization)
- `src/auth.ts` — OAuth 2.0 flow: token storage, refresh, local redirect server on port 8089. Dynamically merges existing token scopes with AdMob scopes on re-auth to avoid invalidating tokens used by other Google MCPs
- `src/authorize.ts` — Standalone CLI script for OAuth authorization (run by `setup.sh`)
- `src/admob-client.ts` — Thin REST client over `https://admob.googleapis.com/v1`
- `src/helpers.ts` — Date math (`daysAgo`, `yesterday`), report row parsing (`parseReportRows`), table formatting (`formatReportTable`), period-over-period change utils (`pctChange`, `addPeriodChanges`)
- `secrets/` — Git-ignored contents (only `.gitkeep` is tracked). Holds `client_secret.json` (OAuth creds) and `token.json` (cached token)
- `setup.sh` — One-command setup: detects and renames credential file, builds, registers MCP server with Claude Code via `claude mcp add`. Supports `--reauth` flag to force re-authorization with updated scopes
- `CLAUDE.md` — Symlink to this file

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

## Contribution Rules

- When adding a new tool, always update the tools table in `README.md` to document it with a prompt example.
- Also update the tool count and tool list in this file (`AGENTS.md`).

## Secrets

Never commit files into `secrets/` beyond `.gitkeep`. The `.gitignore` is configured to ignore `secrets/*` but allow `secrets/.gitkeep`. This directory holds OAuth credentials and tokens.
