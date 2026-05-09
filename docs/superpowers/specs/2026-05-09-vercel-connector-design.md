# Vercel Connector Mode for AdMob MCP

**Date:** 2026-05-09
**Status:** Design approved, awaiting implementation plan
**Owner:** Will Hou

## Problem

The AdMob MCP server is currently stdio-only and runs locally via Claude Code. The user wants to use it across multiple devices (laptop, phone) by adding it as a Claude.ai **Connector**, which requires a remote MCP server over HTTPS. The repo is open-source on GitHub, so the design must also be friendly for any forker who wants to deploy their own instance to Vercel.

The local stdio mode must continue to work — users choose their mode at setup time.

## Goals

1. Keep local stdio mode working with no behavior changes.
2. Add a Vercel deployment path that exposes the MCP server over HTTPS for use as a Claude.ai Connector.
3. Make the Vercel deploy easy for any open-source forker — one-click "Deploy to Vercel" button + interactive `setup.sh` for terminal users.
4. Never commit secrets to the repo. Update `.gitignore` proactively.
5. Preserve the `--reauth` workflow in both modes.

## Non-goals (YAGNI)

- Multi-user OAuth on the connector itself (each deployment is single-tenant by design).
- Per-user Google identities within one deployment.
- A database beyond Vercel KV.
- Dynamic redirect URI configuration — forker hardcodes their Vercel URL in Google Cloud Console.
- Custom CI/CD beyond Vercel's automatic deployments.
- A monorepo / multi-package layout.

## Architecture overview

Two thin entry points share one tools module and one auth module via a `TokenStore` abstraction.

```
┌──────────────────────┐         ┌──────────────────────┐
│  src/index.ts        │         │  api/mcp.ts          │
│  (stdio)             │         │  (HTTP, Vercel)      │
└──────────┬───────────┘         └──────────┬───────────┘
           │                                │
           │  registerTools(server, getClient)
           ▼                                ▼
       ┌─────────────────────────────────────────┐
       │  src/tools.ts  (all 36 tool definitions)│
       └────────────────────┬────────────────────┘
                            │
                            ▼
       ┌─────────────────────────────────────────┐
       │  src/auth.ts  getAuthenticatedClient(   │
       │                  store: TokenStore)      │
       └────────────────────┬────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
       FileTokenStore             KvTokenStore
       (secrets/token.json)       (@vercel/kv)
```

## File changes

### Added

| Path | Purpose |
|---|---|
| `api/mcp.ts` | Streamable HTTP MCP endpoint. Validates `Authorization: Bearer <CONNECTOR_TOKEN>`, instantiates `KvTokenStore`, calls `registerTools()`. |
| `api/setup.ts` | GET: returns small HTML form with a password field. POST: validates token, generates `state` cookie, redirects to Google consent. |
| `api/oauth/callback.ts` | GET: validates `state` cookie, exchanges code for tokens, writes to KV under fixed key `admob:tokens`, returns success HTML page with "add to Claude.ai" instructions. |
| `src/tools.ts` | Exports `registerTools(server: McpServer, getClient: () => Promise<AdMobClient>)` containing all 36 tool definitions. Pure function, no transport coupling. |
| `src/token-store.ts` | `TokenStore` interface + `FileTokenStore` + `KvTokenStore` implementations. |
| `src/http-auth.ts` | `requireBearer(req): boolean` helper using `crypto.timingSafeEqual` against `process.env.CONNECTOR_TOKEN`. |
| `vercel.json` | Function runtime + route config. |
| `.env.example` | Template enumerating `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CONNECTOR_TOKEN`, `OAUTH_REDIRECT_URI`, KV vars. |
| `docs/VERCEL.md` | Forker-facing deploy guide: Google Cloud OAuth setup, Vercel KV provisioning, deploy, first-run authorization, Claude.ai connector setup. |

### Modified

| Path | Change |
|---|---|
| `src/auth.ts` | `getAuthenticatedClient(credentialsPath, tokenStore)` — accepts a `TokenStore` instead of hardcoded file path for tokens. Existing scope-merge, refresh-on-expiry, and `wrapAuthError` logic preserved. The `localhost:8089` HTTP server moves to `authorize.ts` (where it belongs — only the CLI flow needs it). |
| `src/authorize.ts` | Continues to use `FileTokenStore`; adopts the relocated localhost callback logic. No user-visible change. |
| `src/index.ts` | Imports `registerTools` from `tools.ts` and `FileTokenStore` from `token-store.ts`. Tool definitions removed (now in `tools.ts`). |
| `setup.sh` | Becomes interactive: prompts `[L]ocal stdio / [V]ercel / [B]oth`. Local path unchanged. Vercel path generates a `CONNECTOR_TOKEN`, prints `.env.local` for `vercel` CLI users, opens the Deploy-to-Vercel URL, and links to `docs/VERCEL.md`. `--reauth` flag preserved (local: deletes `token.json`; Vercel: prints the `/api/setup` URL). New `--mode=local|vercel|both` flag for non-interactive use. |
| `.gitignore` | Add `.vercel/`, `.env`, `.env.local`, `.env.*.local`. Keep `.env.example` committed. |
| `README.md` | Add "Deploy to Vercel" button at top, brief Connector setup section, link to `docs/VERCEL.md`. Keep existing local-setup docs. |
| `package.json` | Add deps: `@vercel/kv`, `@vercel/node`, `@modelcontextprotocol/sdk` HTTP transport (already in `^1.27.1`). Add scripts: `dev:vercel` (`vercel dev`), `deploy` (`vercel deploy --prod`). |
| `AGENTS.md` (CLAUDE.md symlink) | Document new files, the `TokenStore` abstraction, and dual-mode setup. |

## Data flow — Vercel mode

### First-time authorization
```
forker browser
   │  GET /api/setup
   ▼
api/setup.ts ──► returns HTML form with password field
   │
   │  POST /api/setup  body: {token: <CONNECTOR_TOKEN>}
   ▼
api/setup.ts ──► verify token (timing-safe)
                  ──► generate state, set HttpOnly Secure SameSite=Lax cookie
                  ──► 302 to https://accounts.google.com/...
   │
   ▼
Google consent ──► 302 to /api/oauth/callback?code=...&state=...
   │
   ▼
api/oauth/callback.ts ──► verify state cookie matches
                          ──► exchange code → tokens
                          ──► KvTokenStore.save(tokens)  // key: "admob:tokens"
                          ──► return success HTML
```

### Tool call (steady state)
```
Claude.ai ──► POST /api/mcp  Authorization: Bearer <CONNECTOR_TOKEN>
   │
   ▼
api/mcp.ts ──► requireBearer() — timing-safe compare
              ──► registerTools(server, () => getAuthenticatedClient(creds, kvStore))
              ──► Streamable HTTP transport handles request
   │
   ▼
tool handler ──► getClient() ──► auth.ts loads tokens from KV
                                  ──► refresh if expiry_date < now (writes new tokens to KV)
                                  ──► returns OAuth2 client
              ──► AdMobClient call ──► AdMob REST API
              ──► response back through transport
```

## Token storage abstraction

```ts
// src/token-store.ts
export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
  scope?: string;
}

export interface TokenStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
}

export class FileTokenStore implements TokenStore { /* reads/writes secrets/token.json */ }

export class KvTokenStore implements TokenStore {
  private key = "admob:tokens";
  async load() { return (await kv.get<StoredTokens>(this.key)) ?? null; }
  async save(t: StoredTokens) { await kv.set(this.key, t); }
}
```

`getAuthenticatedClient(credentialsPath, store)` becomes the single entry point. The OAuth-code-exchange path stays in `authorize.ts` (CLI) — Vercel mode never goes through that path; its OAuth happens via `api/setup.ts` + `api/oauth/callback.ts`.

## Connector authentication

- `CONNECTOR_TOKEN` env var = a 32-byte random hex string the forker generates (or `setup.sh` generates).
- Every request to `/api/mcp` requires `Authorization: Bearer <CONNECTOR_TOKEN>`.
- Comparison via `crypto.timingSafeEqual` to prevent timing attacks.
- The token is never placed in a URL query string. The setup flow uses a POST form so the bearer never lands in browser history, server logs, or `Referer` headers.
- Rotation: forker updates the env var in Vercel and re-saves the connector in Claude.ai. No KV change needed.

## OAuth flow security

- **State cookie**: `api/setup.ts` generates a random state, sets `Set-Cookie: admob_oauth_state=<state>; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=600`. `api/oauth/callback.ts` verifies the cookie matches the `state` query param.
- **Token overwrite policy**: the callback unconditionally overwrites `admob:tokens` in KV. This makes reauth trivial — re-visit `/api/setup`. Acceptable because access to the setup form is gated by `CONNECTOR_TOKEN`.
- **Google client config**: forker registers their Vercel callback URL in Google Cloud Console. Mismatch causes Google to refuse the redirect — natural defense against an attacker pointing a different Google client at this deployment.

## setup.sh changes

```
$ ./setup.sh
=== AdMob MCP Server Setup ===

Choose deployment mode:
  [L] Local stdio (Claude Code on this machine)     ← current behavior
  [V] Vercel (Claude.ai Connector, multi-device)
  [B] Both
> _
```

- **Local path**: identical to today — install, build, authorize via `localhost:8089`, `claude mcp add`.
- **Vercel path**:
  1. Generate `CONNECTOR_TOKEN` via `openssl rand -hex 32`.
  2. Write `.env.local` with `CONNECTOR_TOKEN`, placeholder `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`. (`.env.local` is gitignored.)
  3. Print:
     - The Deploy-to-Vercel button URL (so the user can click it from terminal).
     - A pointer to `docs/VERCEL.md` for the full walkthrough.
     - Instructions to set Google Cloud OAuth client to "Web application" type with the eventual `OAUTH_REDIRECT_URI` whitelisted.
- **Both path**: runs Local steps, then Vercel steps.
- **Flags preserved**: `--reauth` works in both modes; new `--mode=local|vercel|both` skips the prompt for non-interactive use.

## README + open-source ergonomics

- **Top of README**: a "Deploy to Vercel" button pointing at the canonical repo (`https://github.com/willhou/admob-mcp`). Full URL form: `https://vercel.com/new/clone?repository-url=https://github.com/willhou/admob-mcp&env=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,CONNECTOR_TOKEN,OAUTH_REDIRECT_URI&envDescription=See+docs/VERCEL.md+for+how+to+obtain+each+value&envLink=https://github.com/willhou/admob-mcp/blob/main/docs/VERCEL.md`. Vercel's import flow walks the user through env-var entry. Forkers can swap the URL to point at their own fork if they want.
- **Connector section** in README explains the two modes briefly, links to `docs/VERCEL.md` for the deep dive.
- **`docs/VERCEL.md`** covers, in order:
  1. Fork the repo.
  2. Click Deploy to Vercel (or `vercel deploy` from CLI).
  3. Provision Vercel KV in the Vercel dashboard.
  4. Create a Google Cloud OAuth client (Web app, with `https://<deploy>.vercel.app/api/oauth/callback` whitelisted, AdMob scopes enabled).
  5. Set env vars in Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `CONNECTOR_TOKEN`.
  6. Visit `https://<deploy>.vercel.app/api/setup`, paste `CONNECTOR_TOKEN`, click Authorize.
  7. In Claude.ai → Settings → Connectors → Add custom connector → URL `https://<deploy>.vercel.app/api/mcp`, Bearer `<CONNECTOR_TOKEN>`.

## .gitignore

Add (preserving existing rules):
```
.vercel/
.env
.env.local
.env.*.local
```
`secrets/*` exclusion (with `!secrets/.gitkeep`) is unchanged. `.env.example` is *not* gitignored — it's the template.

## Operational notes

- **Vercel function timeouts**: Hobby = 10s, Pro = 60s+. Some optimization tools (`revenue_drop_diagnosis`, etc.) make many parallel AdMob calls; if a forker hits 10s on Hobby, document upgrade path or add a fast/slow tool split. Out of scope for this spec — flag for monitoring.
- **Token refresh races**: KV is last-write-wins. Single user across multiple devices makes the race window small. If we observe flakiness, add a KV-based mutex; not pre-emptively.
- **Cold starts**: ~1–2s for the first request after idle. Acceptable.
- **Logs**: ensure `console.error` calls don't include the bearer or refresh token. Existing `auth.ts` logs scopes only — verify during implementation.

## Test strategy

- **Unit**: `TokenStore` implementations (file + KV mocked); `requireBearer` timing-safe behavior; OAuth state validation.
- **Integration (local)**: existing stdio flow continues to authorize and call AdMob. Smoke test 3 tools.
- **Integration (Vercel)**: deploy a test instance, run setup form, add to Claude.ai, exercise 3 tools. Manual.
- **Negative**: wrong bearer → 401; missing state cookie → 400; expired token in KV triggers refresh and saves new token.

## Open questions

None — all resolved during brainstorming. Decisions captured above.

## Out of scope (deferred)

- Multi-user connector OAuth (would require dynamic client registration).
- Postgres or other DB.
- Function timeout mitigation beyond documenting Hobby vs Pro.
- Connector-side rate limiting beyond Vercel's defaults.
