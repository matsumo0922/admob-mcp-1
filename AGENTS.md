# AdMob MCP Server

Local MCP server that connects Claude to the Google AdMob API via OAuth 2.0.

## Build & Run

```bash
npm install
npm run build      # tsc → dist/
npm run start      # run server on stdio
```

## Project Layout

- `src/index.ts` — MCP server entry point, all tool definitions (6 core + 10 reporting + 10 optimization)
- `src/auth.ts` — OAuth 2.0 flow: token storage, refresh, local redirect server on port 8089
- `src/admob-client.ts` — Thin REST client over `https://admob.googleapis.com/v1`
- `src/helpers.ts` — Date math, report row parsing, table formatting, period-over-period change utils
- `secrets/` — Git-ignored. Holds `client_secret.json` (OAuth creds) and `token.json` (cached token)
- `setup.sh` — One-command setup: renames credential file, builds, registers MCP with Claude Code

## Key Patterns

- All tools use `z` (zod) schemas for input validation
- Report tools return pre-formatted ASCII tables with earnings converted from micros to dollars
- High-level tools (revenue_trend, ad_unit_performance, etc.) have sensible defaults so only `account_id` is required
- The AdMob API returns streaming responses (array of header/row/footer objects); `parseReportRows()` in helpers.ts normalizes these
- OAuth tokens are stored in `secrets/token.json` and auto-refreshed when expired

## Secrets

Never commit the `secrets/` directory. It contains OAuth credentials and tokens.
