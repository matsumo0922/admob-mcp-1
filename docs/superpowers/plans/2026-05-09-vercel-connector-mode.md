# Vercel Connector Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Vercel HTTP deployment path so the AdMob MCP server can be used as a Claude.ai Connector across multiple devices, while preserving the existing local stdio mode and remaining safe to open-source.

**Architecture:** Two thin entry points (`src/index.ts` for stdio, `api/mcp.ts` for HTTP) share `src/tools.ts` (all 36 tool definitions) and `src/auth.ts` (refactored to accept a `TokenStore`). `FileTokenStore` backs local mode; `KvTokenStore` backs Vercel mode via Vercel KV. The HTTP endpoint is gated by a static `CONNECTOR_TOKEN` bearer; first-time Google OAuth runs through a small `/api/setup` POST form so the bearer never appears in URLs. `setup.sh` becomes an interactive picker (Local / Vercel / Both) with a `--mode=` flag for non-interactive use and the existing `--reauth` flag preserved.

**Tech Stack:** TypeScript (Node16 modules, CommonJS output, ES2022 target), `@modelcontextprotocol/sdk` (^1.27.1), `googleapis` (^171.4.0), `@vercel/node` (Node 20 runtime), `@vercel/kv` (Upstash Redis), `vitest` (unit tests), Vercel platform.

---

## Spec reference

`docs/superpowers/specs/2026-05-09-vercel-connector-design.md` — read first if you weren't part of brainstorming.

## File structure (target end state)

```
admob-mcp/
├─ api/                          # NEW — Vercel functions
│  ├─ mcp.ts                     # Streamable HTTP MCP endpoint (bearer-gated)
│  ├─ setup.ts                   # GET form + POST handler that initiates Google OAuth
│  └─ oauth/
│     └─ callback.ts             # Google redirect URI; stores token in KV
├─ src/
│  ├─ admob-client.ts            # unchanged
│  ├─ auth.ts                    # MODIFIED — accepts TokenStore
│  ├─ authorize.ts               # MODIFIED — passes FileTokenStore explicitly
│  ├─ helpers.ts                 # unchanged
│  ├─ http-auth.ts               # NEW — timing-safe bearer check
│  ├─ index.ts                   # MODIFIED — uses registerTools(), FileTokenStore
│  ├─ token-store.ts             # NEW — TokenStore interface + File/Kv implementations
│  └─ tools.ts                   # NEW — registerTools(server, getClient) (all 36 tools)
├─ tests/                        # NEW
│  ├─ http-auth.test.ts
│  ├─ token-store.test.ts
│  └─ oauth-state.test.ts        # if state helper extracted
├─ docs/
│  ├─ superpowers/specs/...      # existing
│  ├─ superpowers/plans/...      # existing
│  └─ VERCEL.md                  # NEW — forker deploy guide
├─ secrets/                      # unchanged (gitignored except .gitkeep)
├─ .env.example                  # NEW — template for required env vars
├─ .gitignore                    # MODIFIED — add .vercel/, .env, .env.local, .env.*.local
├─ AGENTS.md / CLAUDE.md         # MODIFIED — document new structure
├─ README.md                     # MODIFIED — Deploy-to-Vercel button + connector section
├─ package.json                  # MODIFIED — new deps and scripts
├─ setup.sh                      # MODIFIED — interactive + --mode + --reauth preserved
├─ tsconfig.json                 # MODIFIED — include api/ and tests/ for editor type-check
└─ vercel.json                   # NEW — function runtime + routes
```

## Task ordering rationale

Phase 1 (Tasks 1–9) refactors and extracts without changing local-mode behavior. After Phase 1, stdio mode must still build and run.

Phase 2 (Tasks 10–16) adds Vercel-specific code that doesn't affect the stdio path.

Phase 3 (Tasks 17–20) updates tooling and docs.

Run `npm run build` at the end of every phase to catch type errors early.

---

## Task 1: Update .gitignore for Vercel + dotenv safety

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Replace `.gitignore` content**

The new content (full file):

```
node_modules/
dist/
secrets/*
!secrets/.gitkeep
memory/
*.tsbuildinfo

# Vercel
.vercel/

# Env files (never commit; use .env.example for templates)
.env
.env.local
.env.*.local
```

- [ ] **Step 2: Verify no env files are currently tracked**

Run:
```
git ls-files | grep -E '^\.env|^\.vercel'
```
Expected: empty output (nothing currently tracked).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "Update .gitignore for Vercel and dotenv files

Pre-emptive update before adding Vercel deployment path. Ensures
.vercel/ project state and any local env files stay out of the
open-source repo.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add vitest test framework

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Add dev dependencies**

Run:
```bash
npm install --save-dev vitest @types/node
```
Expected: `vitest` added to `devDependencies`. (`@types/node` already present — confirms the version is current.)

- [ ] **Step 2: Add `test` script to package.json**

In `package.json`, change the `scripts` block to:
```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "authorize": "node dist/authorize.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Create `vitest.config.ts`**

Create `vitest.config.ts` with:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `tests/` directory with a smoke test**

Create `tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run tests to confirm setup**

Run:
```bash
npm test
```
Expected: 1 test passes. If `tsx`/loader complaints, vitest auto-handles TS — recheck Node version (>= 18.18 required).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/smoke.test.ts
git commit -m "Add vitest test framework

Lightweight unit-test setup ahead of the TokenStore and http-auth
helpers introduced for Vercel mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Implement TokenStore interface + FileTokenStore (TDD)

**Files:**
- Create: `src/token-store.ts`
- Create: `tests/token-store.test.ts`

- [ ] **Step 1: Write the failing tests for FileTokenStore**

Create `tests/token-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileTokenStore, type StoredTokens } from "../src/token-store";

describe("FileTokenStore", () => {
  let tmpDir: string;
  let tokenPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "admob-mcp-test-"));
    tokenPath = path.join(tmpDir, "token.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no token file exists", async () => {
    const store = new FileTokenStore(tokenPath);
    expect(await store.load()).toBeNull();
  });

  it("returns null when token file is malformed", async () => {
    fs.writeFileSync(tokenPath, "{ not json");
    const store = new FileTokenStore(tokenPath);
    expect(await store.load()).toBeNull();
  });

  it("round-trips tokens through save/load", async () => {
    const store = new FileTokenStore(tokenPath);
    const tokens: StoredTokens = {
      access_token: "at",
      refresh_token: "rt",
      token_type: "Bearer",
      expiry_date: 1234567890,
      scope: "scope-a scope-b",
    };
    await store.save(tokens);
    expect(await store.load()).toEqual(tokens);
  });

  it("overwrites existing token file on save", async () => {
    const store = new FileTokenStore(tokenPath);
    await store.save({
      access_token: "first",
      refresh_token: "rt",
      token_type: "Bearer",
      expiry_date: 1,
    });
    await store.save({
      access_token: "second",
      refresh_token: "rt",
      token_type: "Bearer",
      expiry_date: 2,
    });
    const loaded = await store.load();
    expect(loaded?.access_token).toBe("second");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run:
```bash
npm test
```
Expected: FAIL — module `../src/token-store` not found.

- [ ] **Step 3: Implement `src/token-store.ts`**

Create `src/token-store.ts`:
```ts
import * as fs from "fs";

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

export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}

  async load(): Promise<StoredTokens | null> {
    try {
      const content = fs.readFileSync(this.path, "utf-8");
      return JSON.parse(content) as StoredTokens;
    } catch {
      return null;
    }
  }

  async save(tokens: StoredTokens): Promise<void> {
    fs.writeFileSync(this.path, JSON.stringify(tokens, null, 2));
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run:
```bash
npm test
```
Expected: 5 tests pass (4 new + 1 smoke).

- [ ] **Step 5: Commit**

```bash
git add src/token-store.ts tests/token-store.test.ts
git commit -m "Add TokenStore interface and FileTokenStore

Abstracts token persistence so auth.ts can support both filesystem
(local stdio) and Vercel KV backends.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Refactor auth.ts to use TokenStore

**Files:**
- Modify: `src/auth.ts`
- Modify: `src/authorize.ts`

- [ ] **Step 1: Replace `src/auth.ts` content**

Full new content of `src/auth.ts`:
```ts
import { google } from "googleapis";
import * as fs from "fs";
import * as http from "http";
import * as url from "url";
import type { StoredTokens, TokenStore } from "./token-store.js";

const ADMOB_SCOPES = [
  "https://www.googleapis.com/auth/admob.readonly",
  "https://www.googleapis.com/auth/admob.report",
];

const REAUTH_HINT =
  "Run `./setup.sh --reauth` in the admob-mcp directory to re-authorize, then restart the MCP server. " +
  "If this keeps happening, your Google Cloud OAuth consent screen may be in \"Testing\" mode — refresh tokens expire after 7 days in that mode.";

export class AdMobAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdMobAuthError";
  }
}

export function isInvalidGrantError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid_grant/i.test(msg);
}

export function wrapAuthError(err: unknown): Error {
  if (isInvalidGrantError(err)) {
    const original = err instanceof Error ? err.message : String(err);
    return new AdMobAuthError(
      `AdMob OAuth refresh token is invalid or expired (${original}). ${REAUTH_HINT}`
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export interface ClientCredentials {
  client_id: string;
  client_secret: string;
}

export function loadClientCredentialsFromFile(credentialsPath: string): ClientCredentials {
  const content = fs.readFileSync(credentialsPath, "utf-8");
  const json = JSON.parse(content);
  const creds = json.installed || json.web;
  if (!creds) {
    throw new Error("Invalid credentials file. Expected 'installed' or 'web' key.");
  }
  return { client_id: creds.client_id, client_secret: creds.client_secret };
}

/**
 * Returns an OAuth2 client with valid credentials, refreshing if needed.
 * Used by both stdio (FileTokenStore) and HTTP (KvTokenStore) modes.
 * Caller is responsible for ensuring tokens already exist in the store
 * (this function does NOT initiate an interactive OAuth flow).
 */
export async function getAuthenticatedClient(
  creds: ClientCredentials,
  store: TokenStore,
  redirectUri = "http://localhost:8089",
) {
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    redirectUri,
  );

  const stored = await store.load();
  if (!stored) {
    throw new AdMobAuthError(
      "No stored tokens found. Authorize first (local: ./setup.sh, Vercel: visit /api/setup).",
    );
  }

  const hasRequiredScopes =
    stored.scope && ADMOB_SCOPES.every((s) => stored.scope!.includes(s));
  if (!hasRequiredScopes) {
    throw new AdMobAuthError(
      `Stored token is missing required AdMob scopes. ${REAUTH_HINT}`,
    );
  }

  oauth2Client.setCredentials(stored);

  if (stored.expiry_date && stored.expiry_date < Date.now()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const updated: StoredTokens = {
        access_token: credentials.access_token!,
        refresh_token: credentials.refresh_token || stored.refresh_token,
        token_type: credentials.token_type || "Bearer",
        expiry_date: credentials.expiry_date!,
        scope: stored.scope,
      };
      await store.save(updated);
      oauth2Client.setCredentials(updated);
    } catch (err) {
      throw wrapAuthError(err);
    }
  }

  return oauth2Client;
}

/**
 * Interactive OAuth flow that opens a browser and waits for Google to
 * redirect to localhost:8089. Used only by the local CLI (authorize.ts).
 */
export async function authorizeViaLocalServer(
  creds: ClientCredentials,
  store: TokenStore,
): Promise<void> {
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:8089",
  );

  // Merge AdMob scopes with any previously granted scopes
  const mergedScopes = [...ADMOB_SCOPES];
  const existing = await store.load();
  if (existing?.scope) {
    for (const s of existing.scope.split(" ").filter(Boolean)) {
      if (!mergedScopes.includes(s)) mergedScopes.push(s);
    }
  }

  console.error("Requesting scopes:", mergedScopes.join(", "));

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: mergedScopes,
    prompt: "consent",
  });

  const code = await getAuthCodeViaLocalServer(authUrl);
  const { tokens } = await oauth2Client.getToken(code);

  const newTokens: StoredTokens = {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    token_type: tokens.token_type || "Bearer",
    expiry_date: tokens.expiry_date!,
    scope: tokens.scope || mergedScopes.join(" "),
  };

  await store.save(newTokens);
  console.error("Authorization successful! Token saved.");
}

async function getAuthCodeViaLocalServer(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url || "", true);
      const code = parsed.query.code as string | undefined;
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>",
        );
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Authorization failed</h1><p>No code received.</p>");
        server.close();
        reject(new Error("No authorization code received"));
      }
    });

    server.listen(8089, () => {
      console.error(`\n🔐 Open this URL in your browser to authorize:\n`);
      console.error(authUrl);
      console.error(`\nWaiting for authorization...\n`);
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out after 120 seconds"));
    }, 120000);

    server.on("close", () => clearTimeout(timeout));
  });
}

export const ADMOB_OAUTH_SCOPES = ADMOB_SCOPES;
```

- [ ] **Step 2: Update `src/authorize.ts`**

Replace `src/authorize.ts` with:
```ts
import * as path from "path";
import { authorizeViaLocalServer, loadClientCredentialsFromFile } from "./auth.js";
import { FileTokenStore } from "./token-store.js";

const credentialsPath =
  process.env.ADMOB_CREDENTIALS_PATH ||
  path.join(__dirname, "..", "secrets", "client_secret.json");

const tokenPath = path.join(__dirname, "..", "secrets", "token.json");

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
```

- [ ] **Step 3: Build to confirm type-check passes**

Run:
```bash
npm run build
```
Expected: clean compile. (`src/index.ts` will fail because it still calls the old `getAuthenticatedClient(credentialsPath)` signature — that's fixed in Task 7. Build the rest with explicit file targets if needed, but typically the full build will fail here. **It's OK to defer the full build until Task 7** — note the failure and continue.)

If you want to verify just the changed files type-check on their own:
```bash
npx tsc --noEmit src/auth.ts src/authorize.ts src/token-store.ts
```
Expected: clean. (Note: this will pull in transitive imports.)

- [ ] **Step 4: Commit (broken state — `src/index.ts` is briefly mismatched)**

```bash
git add src/auth.ts src/authorize.ts
git commit -m "Refactor auth.ts to accept TokenStore + ClientCredentials

Splits the interactive localhost-callback flow (authorizeViaLocalServer)
from the headless refresh-only flow (getAuthenticatedClient). The
latter now accepts a TokenStore so HTTP mode (Task 12) can plug in
KvTokenStore. src/index.ts is updated to match in a later task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Implement KvTokenStore (TDD with mocked @vercel/kv)

**Files:**
- Modify: `src/token-store.ts`
- Modify: `tests/token-store.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add @vercel/kv dependency**

Run:
```bash
npm install @vercel/kv
```
Expected: `@vercel/kv` in `dependencies`.

- [ ] **Step 2: Append failing KvTokenStore tests**

Append to `tests/token-store.test.ts`:
```ts
import { vi } from "vitest";
import { KvTokenStore } from "../src/token-store";

vi.mock("@vercel/kv", () => {
  const store = new Map<string, unknown>();
  return {
    kv: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: unknown) => {
        store.set(k, v);
        return "OK";
      }),
      del: vi.fn(async (k: string) => {
        const had = store.has(k);
        store.delete(k);
        return had ? 1 : 0;
      }),
      __reset: () => store.clear(),
    },
  };
});

describe("KvTokenStore", () => {
  beforeEach(async () => {
    const mod = await import("@vercel/kv");
    (mod.kv as unknown as { __reset: () => void }).__reset();
  });

  it("returns null when KV has no token", async () => {
    const store = new KvTokenStore();
    expect(await store.load()).toBeNull();
  });

  it("round-trips tokens through save/load", async () => {
    const store = new KvTokenStore();
    const tokens: StoredTokens = {
      access_token: "at",
      refresh_token: "rt",
      token_type: "Bearer",
      expiry_date: 9,
      scope: "s",
    };
    await store.save(tokens);
    expect(await store.load()).toEqual(tokens);
  });

  it("uses the fixed key admob:tokens", async () => {
    const { kv } = await import("@vercel/kv");
    const store = new KvTokenStore();
    await store.save({
      access_token: "a",
      refresh_token: "r",
      token_type: "Bearer",
      expiry_date: 1,
    });
    expect(vi.mocked(kv.set)).toHaveBeenCalledWith(
      "admob:tokens",
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 3: Run tests — confirm they fail**

Run:
```bash
npm test
```
Expected: FAIL — `KvTokenStore` not exported from `../src/token-store`.

- [ ] **Step 4: Implement KvTokenStore**

Append to `src/token-store.ts` (do NOT remove existing exports):
```ts
import { kv } from "@vercel/kv";

export class KvTokenStore implements TokenStore {
  private static readonly KEY = "admob:tokens";

  async load(): Promise<StoredTokens | null> {
    return (await kv.get<StoredTokens>(KvTokenStore.KEY)) ?? null;
  }

  async save(tokens: StoredTokens): Promise<void> {
    await kv.set(KvTokenStore.KEY, tokens);
  }
}
```

- [ ] **Step 5: Run tests — confirm they pass**

Run:
```bash
npm test
```
Expected: 8 tests pass (4 FileTokenStore + 3 KvTokenStore + 1 smoke).

- [ ] **Step 6: Commit**

```bash
git add src/token-store.ts tests/token-store.test.ts package.json package-lock.json
git commit -m "Add KvTokenStore backed by Vercel KV

Token persistence for Vercel mode. Stored under fixed key
'admob:tokens' (single-tenant deployment).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract tools to src/tools.ts

**Files:**
- Create: `src/tools.ts`
- Modify: `src/index.ts`

This task is mechanical: move all tool registrations and their helper schemas/functions out of `src/index.ts` and into `src/tools.ts`. The receiving file exposes a `registerTools(server, getClient)` function.

- [ ] **Step 1: Read current `src/index.ts` end-to-end**

Run:
```bash
wc -l src/index.ts
```
Note the line count. Open the file in your editor.

- [ ] **Step 2: Create `src/tools.ts` with the function shell + schemas + helpers**

Create `src/tools.ts`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AdMobClient } from "./admob-client.js";
import {
  daysAgo,
  yesterday,
  parseReportRows,
  formatReportTable,
  pctChange,
  addPeriodChanges,
} from "./helpers.js";

function formatResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

const DateSchema = z.object({
  year: z.coerce.number().describe("Year (e.g. 2024)"),
  month: z.coerce.number().min(1).max(12).describe("Month (1-12)"),
  day: z.coerce.number().min(1).max(31).describe("Day (1-31)"),
});

const DimensionFilterSchema = z.object({
  dimension: z.string().describe("Dimension to filter on"),
  values: z.array(z.string()).describe("Values to match"),
});

const SortConditionSchema = z.object({
  order: z.enum(["ASCENDING", "DESCENDING"]).optional().describe("Sort order"),
  dimension: z.string().optional().describe("Dimension to sort by"),
  metric: z.string().optional().describe("Metric to sort by"),
});

export function registerTools(
  server: McpServer,
  getClient: () => Promise<AdMobClient>,
): void {
  // PASTE all server.tool(...) calls here from src/index.ts
}
```

- [ ] **Step 3: Move every `server.tool(...)` call from `src/index.ts` into the body of `registerTools`**

In `src/index.ts`, locate every `server.tool(...)` block (there are 36). Cut them all (preserve order, preserve any inter-block comments) and paste inside the `registerTools` body in `src/tools.ts`, replacing the placeholder comment.

Each tool currently calls `await getClient()` directly (the old top-level `getClient` function). That call already matches the parameter name in `registerTools` — no rewrite needed.

Also move any tool-local helper functions or constants that only the tools use (e.g., any local helpers that appeared between tool blocks).

- [ ] **Step 4: Strip the now-unused imports and globals from `src/index.ts`**

After moving, `src/index.ts` should no longer reference `z`, `AdMobClient`, `daysAgo`, etc. Remove any imports that are no longer used. Keep imports needed by the new entry shell (next task).

Don't worry about the file being temporarily incomplete — Task 7 finishes it.

- [ ] **Step 5: Build to confirm `src/tools.ts` type-checks**

Run:
```bash
npx tsc --noEmit
```
Expected: errors only in `src/index.ts` (you'll fix in Task 7); `src/tools.ts` itself should be clean. If `src/tools.ts` has its own errors, fix them before continuing.

- [ ] **Step 6: Commit (still broken state — index.ts incomplete)**

```bash
git add src/tools.ts src/index.ts
git commit -m "Extract tool definitions into src/tools.ts

Pulls all 36 server.tool(...) registrations out of src/index.ts into
a single registerTools(server, getClient) function so both the stdio
entry point (src/index.ts) and the upcoming HTTP entry (api/mcp.ts)
can share them. src/index.ts is finished in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Slim `src/index.ts` to use registerTools + FileTokenStore

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace `src/index.ts` with the new entry shell**

Full new content of `src/index.ts`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "path";
import {
  getAuthenticatedClient,
  loadClientCredentialsFromFile,
} from "./auth.js";
import { AdMobClient } from "./admob-client.js";
import { FileTokenStore } from "./token-store.js";
import { registerTools } from "./tools.js";

const CREDENTIALS_PATH =
  process.env.ADMOB_CREDENTIALS_PATH ||
  path.join(__dirname, "..", "secrets", "client_secret.json");

const TOKEN_PATH = path.join(__dirname, "..", "secrets", "token.json");

let admobClient: AdMobClient | null = null;

async function getClient(): Promise<AdMobClient> {
  if (!admobClient) {
    const creds = loadClientCredentialsFromFile(CREDENTIALS_PATH);
    const store = new FileTokenStore(TOKEN_PATH);
    const auth = await getAuthenticatedClient(creds, store);
    admobClient = new AdMobClient(auth);
  }
  return admobClient;
}

const server = new McpServer({
  name: "admob-mcp",
  version: "1.0.0",
});

registerTools(server, getClient);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AdMob MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Build the whole project**

Run:
```bash
npm run build
```
Expected: clean compile with no errors.

- [ ] **Step 3: Run tests to confirm nothing regressed**

Run:
```bash
npm test
```
Expected: 8 passing.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "Slim src/index.ts to thin stdio entry point

Imports registerTools and FileTokenStore. Behavior preserved: same
credentials path, same token path, same stdio transport.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Smoke-test the local stdio path end-to-end

This is a manual checkpoint to confirm the refactor preserved behavior before adding Vercel code. No code changes.

- [ ] **Step 1: Build**

Run:
```bash
npm run build
```
Expected: clean.

- [ ] **Step 2: Verify the binary still loads**

Run:
```bash
node dist/index.js < /dev/null
```
Expected: prints `AdMob MCP server running on stdio` to stderr, then waits for stdin. Press Ctrl+C to exit. (The server can't do anything useful without a real MCP client connected, but it should boot without crashing.)

- [ ] **Step 3: Verify the existing Claude Code registration still works**

If the user has `admob` registered (from a previous setup.sh run), open Claude Code, run `/mcp` to list servers. The `admob` server should appear with its 36 tools and respond to a quick `list_accounts` call.

If it doesn't (e.g., a token is missing because of refactor), run:
```bash
./setup.sh --reauth
```
which should now use the updated authorize flow and produce a working token.

- [ ] **Step 4: No commit needed (no code changes)**

If you discover a regression, fix it now before proceeding to Phase 2.

---

## Task 9: Add Vercel deps and update tsconfig

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: Install @vercel/node**

Run:
```bash
npm install @vercel/node
```
Expected: `@vercel/node` in `dependencies`.

- [ ] **Step 2: Update tsconfig.json includes**

Replace `tsconfig.json` with:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*", "api/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Note: `rootDir` widened to `./` so the compiler accepts files outside `src/`. The `dist/` output mirrors the input layout (`dist/src/...`, `dist/api/...`, `dist/tests/...`).

- [ ] **Step 3: Update package.json `main` and `start` for new dist layout**

In `package.json`, update:
```json
  "main": "dist/src/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/src/index.js",
    "authorize": "node dist/src/authorize.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev:vercel": "vercel dev",
    "deploy": "vercel deploy --prod"
  },
```

- [ ] **Step 4: Build and confirm new layout**

Run:
```bash
rm -rf dist && npm run build && ls dist
```
Expected: `dist/src/index.js`, `dist/src/auth.js`, `dist/src/tools.js`, `dist/src/token-store.js`, `dist/src/authorize.js`, etc.

- [ ] **Step 5: Update setup.sh and any other references to the old `dist/index.js` path**

Search for the old path:
```bash
grep -rn "dist/index" .  --include='*.sh' --include='*.json' --include='*.md'
```
Anywhere it appears (likely `setup.sh` and `README.md`), update to `dist/src/index.js`. (The full `setup.sh` rewrite happens in Task 17 — a quick find-and-replace here is enough to keep the script runnable in the meantime.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json setup.sh README.md
git commit -m "Add @vercel/node and broaden tsconfig for api/ and tests/

Compiler now accepts files outside src/; dist mirrors the layout.
Updated 'main', 'start', and 'authorize' scripts (and setup.sh
references) for the new dist/src/ path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Implement http-auth.ts (TDD)

**Files:**
- Create: `src/http-auth.ts`
- Create: `tests/http-auth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/http-auth.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkBearer } from "../src/http-auth";

describe("checkBearer", () => {
  const ORIGINAL = process.env.CONNECTOR_TOKEN;

  beforeEach(() => {
    process.env.CONNECTOR_TOKEN = "secret-abc-1234567890";
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CONNECTOR_TOKEN;
    else process.env.CONNECTOR_TOKEN = ORIGINAL;
  });

  it("accepts a matching Bearer header", () => {
    expect(checkBearer("Bearer secret-abc-1234567890")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(checkBearer("Bearer wrong")).toBe(false);
  });

  it("rejects when header is missing", () => {
    expect(checkBearer(undefined)).toBe(false);
  });

  it("rejects when scheme is not Bearer", () => {
    expect(checkBearer("Basic secret-abc-1234567890")).toBe(false);
  });

  it("rejects when CONNECTOR_TOKEN env var is unset", () => {
    delete process.env.CONNECTOR_TOKEN;
    expect(checkBearer("Bearer anything")).toBe(false);
  });

  it("rejects tokens of different length without timing leak", () => {
    expect(checkBearer("Bearer short")).toBe(false);
    expect(checkBearer("Bearer waaaaaaaaaaaaaaaaaaaaaaay-too-long")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run:
```bash
npm test
```
Expected: FAIL — `../src/http-auth` not found.

- [ ] **Step 3: Implement `src/http-auth.ts`**

Create `src/http-auth.ts`:
```ts
import { timingSafeEqual } from "crypto";

/**
 * Validates an Authorization header against CONNECTOR_TOKEN env var.
 * Uses constant-time comparison. Returns false if the env var is unset
 * (refuse-by-default — never authorize without an explicit secret).
 */
export function checkBearer(authHeader: string | undefined): boolean {
  const expected = process.env.CONNECTOR_TOKEN;
  if (!expected) return false;
  if (!authHeader) return false;

  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match) return false;
  const provided = match[1];

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run:
```bash
npm test
```
Expected: 14 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add src/http-auth.ts tests/http-auth.test.ts
git commit -m "Add timing-safe bearer check for HTTP endpoints

Refuse-by-default if CONNECTOR_TOKEN is unset. Constant-time
comparison via crypto.timingSafeEqual.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Implement api/mcp.ts (HTTP MCP endpoint)

**Files:**
- Create: `api/mcp.ts`

- [ ] **Step 1: Create `api/mcp.ts`**

Create `api/mcp.ts`:
```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getAuthenticatedClient } from "../src/auth.js";
import { AdMobClient } from "../src/admob-client.js";
import { KvTokenStore } from "../src/token-store.js";
import { registerTools } from "../src/tools.js";
import { checkBearer } from "../src/http-auth.js";

export const config = {
  runtime: "nodejs20.x",
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkBearer(req.headers["authorization"])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "Server misconfigured: GOOGLE_CLIENT_ID/SECRET missing" });
    return;
  }

  const store = new KvTokenStore();
  let admobClient: AdMobClient | null = null;
  const getClient = async (): Promise<AdMobClient> => {
    if (!admobClient) {
      const auth = await getAuthenticatedClient(
        { client_id: clientId, client_secret: clientSecret },
        store,
      );
      admobClient = new AdMobClient(auth);
    }
    return admobClient;
  };

  const server = new McpServer({ name: "admob-mcp", version: "1.0.0" });
  registerTools(server, getClient);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — each request stands alone
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
```

- [ ] **Step 2: Build to confirm type-check**

Run:
```bash
npm run build
```
Expected: clean. If `StreamableHTTPServerTransport` import path is wrong (varies by SDK minor version), check `node_modules/@modelcontextprotocol/sdk/dist/esm/server/` for the correct file. The expected path is `streamableHttp.js`.

- [ ] **Step 3: Commit**

```bash
git add api/mcp.ts
git commit -m "Add HTTP MCP endpoint at api/mcp.ts

Stateless Streamable HTTP transport. Bearer-gated. Lazily builds
the AdMob client per request from KvTokenStore.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Implement api/setup.ts (OAuth init form + handler)

**Files:**
- Create: `api/setup.ts`

- [ ] **Step 1: Create `api/setup.ts`**

Create `api/setup.ts`:
```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { randomBytes } from "crypto";
import { checkBearer } from "../src/http-auth.js";

export const config = { runtime: "nodejs20.x" };

const ADMOB_SCOPES = [
  "https://www.googleapis.com/auth/admob.readonly",
  "https://www.googleapis.com/auth/admob.report",
];

const FORM_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AdMob MCP Setup</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px}
input{width:100%;padding:8px;font-size:14px;margin:8px 0}
button{padding:10px 16px;font-size:14px}</style></head>
<body>
<h1>AdMob MCP — Authorize</h1>
<p>Paste your <code>CONNECTOR_TOKEN</code> (from Vercel env vars) and click Authorize.
You'll be sent to Google's consent screen, then back here.</p>
<form method="POST" action="/api/setup">
  <input type="password" name="token" placeholder="CONNECTOR_TOKEN" autocomplete="off" required>
  <button type="submit">Authorize with Google</button>
</form>
</body></html>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(FORM_HTML);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const submitted =
    typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, string>).token
      : undefined;

  if (!checkBearer(submitted ? `Bearer ${submitted}` : undefined)) {
    res.status(401).send("Invalid CONNECTOR_TOKEN.");
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send("Server misconfigured: missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or OAUTH_REDIRECT_URI.");
    return;
  }

  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const state = randomBytes(32).toString("hex");

  res.setHeader(
    "Set-Cookie",
    `admob_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=600`,
  );

  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    scope: ADMOB_SCOPES,
    prompt: "consent",
    state,
  });

  res.redirect(302, authUrl);
}
```

- [ ] **Step 2: Build to confirm type-check**

Run:
```bash
npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add api/setup.ts
git commit -m "Add /api/setup OAuth-init form

GET renders a small HTML form; POST validates the connector token
(via timing-safe checkBearer), generates a state cookie, and
redirects to Google's consent screen. Token is never placed in a
URL — kept out of browser history and server access logs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Implement api/oauth/callback.ts

**Files:**
- Create: `api/oauth/callback.ts`

- [ ] **Step 1: Create `api/oauth/callback.ts`**

Create `api/oauth/callback.ts`:
```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { KvTokenStore } from "../../src/token-store.js";
import type { StoredTokens } from "../../src/token-store.js";

export const config = { runtime: "nodejs20.x" };

function parseStateCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const m = /(?:^|;\s*)admob_oauth_state=([^;]+)/.exec(cookieHeader);
  return m ? m[1] : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const errorParam = typeof req.query.error === "string" ? req.query.error : null;

  if (errorParam) {
    res.status(400).send(`<h1>Authorization failed</h1><p>${escapeHtml(errorParam)}</p>`);
    return;
  }
  if (!code || !state) {
    res.status(400).send("<h1>Missing code or state</h1>");
    return;
  }

  const cookieState = parseStateCookie(req.headers["cookie"]);
  if (!cookieState || cookieState !== state) {
    res.status(400).send("<h1>State mismatch — possible CSRF</h1>");
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send("Server misconfigured.");
    return;
  }

  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  let tokens;
  try {
    const result = await oauth.getToken(code);
    tokens = result.tokens;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<h1>Token exchange failed</h1><pre>${escapeHtml(msg)}</pre>`);
    return;
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    res
      .status(400)
      .send(
        "<h1>Missing refresh_token</h1><p>Re-run the setup with prompt=consent. Make sure Google's consent screen lets you grant offline access.</p>",
      );
    return;
  }

  const stored: StoredTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || "Bearer",
    expiry_date: tokens.expiry_date!,
    scope: tokens.scope,
  };

  const store = new KvTokenStore();
  await store.save(stored);

  res.setHeader("Set-Cookie", "admob_oauth_state=; Path=/api/oauth; Max-Age=0");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(SUCCESS_HTML);
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorized</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:64px auto;padding:0 16px}
code{background:#f4f4f4;padding:2px 4px;border-radius:3px}</style></head>
<body>
<h1>✅ Authorized</h1>
<p>Your AdMob OAuth tokens are stored. Now add this server as a Connector in Claude.ai:</p>
<ol>
  <li>Go to Claude.ai → Settings → Connectors → <strong>Add custom connector</strong>.</li>
  <li>URL: <code>https://&lt;your-deploy&gt;.vercel.app/api/mcp</code></li>
  <li>Authentication: Bearer token (use the same <code>CONNECTOR_TOKEN</code> you just entered).</li>
</ol>
<p>You can close this window.</p>
</body></html>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}
```

- [ ] **Step 2: Build to confirm type-check**

Run:
```bash
npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add api/oauth/callback.ts
git commit -m "Add Google OAuth callback handler

Validates state cookie (CSRF), exchanges code for tokens, persists
to Vercel KV via KvTokenStore, returns success page with Claude.ai
connector setup instructions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Create vercel.json

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create `vercel.json`**

Create `vercel.json`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/mcp.ts": {
      "maxDuration": 60
    },
    "api/setup.ts": {
      "maxDuration": 10
    },
    "api/oauth/callback.ts": {
      "maxDuration": 10
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "Add vercel.json with per-function timeouts

api/mcp can run up to 60s for tool calls that fan out across
multiple AdMob requests; auth endpoints stay at 10s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Create .env.example

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

Create `.env.example`:
```
# Google OAuth client (Web application type) — see docs/VERCEL.md
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Public callback URL for the Google OAuth flow.
# Must match an "Authorized redirect URI" configured on the Google client.
# Example: https://admob-mcp.vercel.app/api/oauth/callback
OAUTH_REDIRECT_URI=

# Static bearer that gates /api/mcp and /api/setup.
# Generate with: openssl rand -hex 32
# Paste the same value into the Claude.ai connector configuration.
CONNECTOR_TOKEN=

# --- Vercel KV (auto-injected when you provision Vercel KV / Upstash) ---
# Do NOT set these manually; Vercel populates them after KV is linked.
# KV_URL=
# KV_REST_API_URL=
# KV_REST_API_TOKEN=
# KV_REST_API_READ_ONLY_TOKEN=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "Add .env.example template

Forkers fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
OAUTH_REDIRECT_URI, and CONNECTOR_TOKEN. KV vars come from Vercel
KV provisioning.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Update setup.sh — interactive + --mode + --reauth

**Files:**
- Modify: `setup.sh`

- [ ] **Step 1: Replace `setup.sh` with new content**

Full new content of `setup.sh`:
```bash
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
```

- [ ] **Step 2: Make sure script is executable**

Run:
```bash
chmod +x setup.sh
```
Expected: no output.

- [ ] **Step 3: Sanity-check the help flag**

Run:
```bash
./setup.sh --help
```
Expected: usage text printed.

- [ ] **Step 4: Commit**

```bash
git add setup.sh
git commit -m "Make setup.sh interactive with mode picker

Adds [L]ocal / [V]ercel / [B]oth modes plus --mode=... and --help
flags. Vercel path generates a CONNECTOR_TOKEN, writes .env.local,
and prints a step-by-step deployment checklist. --reauth preserved
for both modes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Create docs/VERCEL.md (forker deploy guide)

**Files:**
- Create: `docs/VERCEL.md`

- [ ] **Step 1: Create `docs/VERCEL.md`**

Create `docs/VERCEL.md`:
```markdown
# Deploying AdMob MCP to Vercel as a Claude Connector

This guide walks you through deploying your own instance of the AdMob MCP server to Vercel and adding it to Claude.ai as a custom Connector. After setup, you can use the AdMob tools from Claude on any device — laptop, phone, or web.

This is a **single-tenant** deployment: your fork, your Google account, your AdMob data. Don't share the URL or `CONNECTOR_TOKEN` with anyone you wouldn't share AdMob console access with.

## Prerequisites

- A GitHub account.
- A Vercel account (free tier works).
- A Google Cloud project with the AdMob API enabled.
- An AdMob account with a publisher ID.

## 1. Fork the repo

Click **Fork** on https://github.com/willhou/admob-mcp.

## 2. Click Deploy to Vercel

In the README of your fork (or the upstream README), click the **Deploy to Vercel** button. Vercel imports the repo and asks you to fill in environment variables.

If you prefer the CLI: run `npm install -g vercel`, then from your forked clone:
```bash
vercel link
vercel deploy --prod
```

You'll add the env vars in the Vercel dashboard after the first deploy (the function code refuses to start until they're set, which is fine).

## 3. Provision Vercel KV

In your Vercel project dashboard:

1. **Storage** tab → **Create Database** → **KV**.
2. Name it (e.g. `admob-tokens`) and connect it to your project.
3. Vercel auto-injects `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, etc. — you don't need to set them manually.

## 4. Create a Google OAuth client

1. Go to https://console.cloud.google.com/apis/credentials.
2. Pick the project that has the AdMob API enabled.
3. **Create Credentials → OAuth client ID → Application type: Web application**.
4. **Authorized redirect URIs**: add `https://<your-deploy>.vercel.app/api/oauth/callback` (use your actual Vercel deployment URL).
5. Save. Note the **Client ID** and **Client secret**.

If your Google Cloud OAuth consent screen is in **Testing** mode, refresh tokens expire after 7 days — fine for personal use, but plan to publish the consent screen if you want longer-lived auth.

## 5. Generate a CONNECTOR_TOKEN

A long random secret that gates your endpoints. Generate one:
```bash
openssl rand -hex 32
```
Or run `./setup.sh --mode=vercel` from a clone, which generates and prints one for you.

## 6. Set Vercel environment variables

In **Project Settings → Environment Variables**, add (Production scope):

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 4 |
| `GOOGLE_CLIENT_SECRET` | from step 4 |
| `OAUTH_REDIRECT_URI` | `https://<your-deploy>.vercel.app/api/oauth/callback` |
| `CONNECTOR_TOKEN` | the token from step 5 |

Save. Vercel offers to redeploy — accept.

## 7. Authorize Google access

1. Visit `https://<your-deploy>.vercel.app/api/setup`.
2. Paste your `CONNECTOR_TOKEN`. Click **Authorize with Google**.
3. Sign in with the Google account that owns the AdMob publisher you want to query. Grant the requested scopes (`admob.readonly`, `admob.report`).
4. You'll be redirected back to a success page. Your tokens are now stored in Vercel KV.

## 8. Add the connector to Claude.ai

1. Claude.ai → **Settings → Connectors → Add custom connector**.
2. **URL:** `https://<your-deploy>.vercel.app/api/mcp`
3. **Authentication:** Bearer token. Paste your `CONNECTOR_TOKEN`.
4. Save. The connector now appears across all your Claude clients (web, mobile, desktop).

## Re-authorization

Refresh tokens can expire (especially with a Testing-mode consent screen). To re-authorize without changing your `CONNECTOR_TOKEN`:

1. Visit `https://<your-deploy>.vercel.app/api/setup`.
2. Paste your `CONNECTOR_TOKEN`, click Authorize, complete the Google flow.
3. Stored token in Vercel KV is overwritten.

## Rotating the CONNECTOR_TOKEN

1. Generate a new value: `openssl rand -hex 32`.
2. Update `CONNECTOR_TOKEN` in Vercel project env vars; redeploy.
3. Update the bearer in Claude.ai → Settings → Connectors → (your connector).

## Troubleshooting

- **`/api/mcp` returns 401**: bearer mismatch. Confirm Vercel env var matches what you pasted into Claude.ai.
- **`/api/oauth/callback` returns "State mismatch"**: cookie missing or stale; restart the flow at `/api/setup`.
- **Tools fail with `invalid_grant`**: refresh token expired. Re-authorize via step 7.
- **Function timeout (10s)**: you're on the Hobby tier. Either upgrade or only use lighter-weight tools. The `revenue_drop_diagnosis` and `app_deep_dive` tools fan out across many AdMob calls.
- **`KV_URL` not set**: Vercel KV not provisioned, or not linked to the project.

## Security notes

- The `CONNECTOR_TOKEN` is the only thing standing between an attacker and your AdMob data. Treat it like a password.
- Don't put the token in URL query strings — the `/api/setup` flow uses a POST form deliberately.
- Consider rotating the token if you suspect exposure.
- The Google OAuth callback URL is locked to your Vercel deploy in Google Cloud Console — even with a stolen `CONNECTOR_TOKEN`, an attacker cannot redirect tokens elsewhere without also editing your Google client.
```

- [ ] **Step 2: Commit**

```bash
git add docs/VERCEL.md
git commit -m "Add docs/VERCEL.md deployment guide

Step-by-step walkthrough for forkers: Google Cloud OAuth client,
Vercel KV provisioning, env vars, /api/setup auth, Claude.ai
connector configuration. Includes re-auth, rotation, and
troubleshooting sections.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Update README.md with Deploy button + connector section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current README to understand structure**

Run:
```bash
cat README.md
```
Note the current sections so the additions blend with existing style.

- [ ] **Step 2: Add a "Deploy to Vercel" badge near the top**

Insert directly under the project's H1 (the very first heading):

```markdown
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwillhou%2Fadmob-mcp&env=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,CONNECTOR_TOKEN,OAUTH_REDIRECT_URI&envDescription=See%20docs%2FVERCEL.md%20for%20how%20to%20obtain%20each%20value&envLink=https%3A%2F%2Fgithub.com%2Fwillhou%2Fadmob-mcp%2Fblob%2Fmain%2Fdocs%2FVERCEL.md)

Two ways to use this server:
- **Local stdio (Claude Code on one machine):** run `./setup.sh` and pick **L**.
- **Vercel + Claude.ai Connector (multi-device):** click the badge above, then follow [docs/VERCEL.md](docs/VERCEL.md). Or run `./setup.sh` and pick **V**.
```

- [ ] **Step 3: Add a "Connector setup (Vercel)" section near the existing setup instructions**

Insert (or replace any existing Vercel section) with:

```markdown
## Connector setup (Vercel)

Use this if you want the AdMob tools available in Claude.ai on every device, not just Claude Code on your laptop.

1. Fork the repo.
2. Click **Deploy with Vercel** above.
3. Provision Vercel KV in the project dashboard.
4. Create a Google Cloud OAuth client (Web app). Authorized redirect URI = `https://<your-deploy>.vercel.app/api/oauth/callback`.
5. Set env vars in Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `CONNECTOR_TOKEN` (generate with `openssl rand -hex 32`).
6. Visit `https://<your-deploy>.vercel.app/api/setup` and authorize.
7. Add the URL to Claude.ai → Settings → Connectors with `CONNECTOR_TOKEN` as the bearer.

Full walkthrough including troubleshooting: [docs/VERCEL.md](docs/VERCEL.md).
```

- [ ] **Step 4: If the existing README references `dist/index.js` paths or old setup-flag behavior, update those mentions to match `dist/src/index.js` and the new interactive `setup.sh`**

Run:
```bash
grep -n "dist/index" README.md
grep -n "setup.sh" README.md
```
Update any stale references.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Add Deploy-to-Vercel button and Connector setup section to README

Surfaces the Vercel path for open-source forkers. Keeps the local
stdio path as the documented default for Claude Code users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Update AGENTS.md (CLAUDE.md symlink) to reflect new structure

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update the Project Layout section**

In `AGENTS.md`, replace the current "Project Layout" bullet list with:

```markdown
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
```

- [ ] **Step 2: Update the Build & Run block**

Replace the current `## Build & Run` block with:

```markdown
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
```

- [ ] **Step 3: Update the Key Patterns section**

Append to "Key Patterns":

```markdown
- Token storage is abstracted behind `TokenStore` (`FileTokenStore` for local, `KvTokenStore` for Vercel). `auth.ts` does not know about filesystems or KV.
- The HTTP MCP endpoint (`api/mcp.ts`) is stateless — each request constructs its own `McpServer` and `StreamableHTTPServerTransport`.
- `CONNECTOR_TOKEN` gates `api/mcp.ts` and `api/setup.ts`. Comparison is timing-safe.
- OAuth state is stored in an `HttpOnly Secure SameSite=Lax` cookie scoped to `/api/oauth`.
```

- [ ] **Step 4: Update the Contribution Rules section**

Append:

```markdown
- When adding a new env var, document it in `.env.example` *and* `docs/VERCEL.md`.
- Don't put `CONNECTOR_TOKEN` in URLs. The `/api/setup` flow uses a POST form deliberately.
```

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "Update AGENTS.md for dual-mode (local + Vercel) layout

Documents src/tools.ts, src/token-store.ts, src/http-auth.ts, the
api/ tree, and the new setup.sh modes. Adds contribution rules
about env vars and bearer-in-URL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Final verification

No code changes; full pre-merge checklist.

- [ ] **Step 1: Clean build**

Run:
```bash
rm -rf dist && npm run build
```
Expected: clean compile.

- [ ] **Step 2: Tests pass**

Run:
```bash
npm test
```
Expected: all tests pass (smoke + 4 FileTokenStore + 3 KvTokenStore + 6 http-auth = 14 minimum).

- [ ] **Step 3: Lint imports — confirm no unused or orphaned files**

Run:
```bash
grep -rn "from \"\\./" src api | grep -E "auth\\.js|token-store\\.js|tools\\.js|http-auth\\.js"
```
Expected: every imported relative path resolves to an existing `.ts` file under `src/` or `api/`.

- [ ] **Step 4: Local stdio smoke test**

Run:
```bash
node dist/src/index.js < /dev/null &
PID=$!
sleep 1
kill $PID 2>/dev/null || true
```
Expected: process starts, prints "AdMob MCP server running on stdio" to stderr, exits cleanly when killed.

- [ ] **Step 5: Vercel dev smoke test (manual)**

Run:
```bash
vercel dev
```
- Visit `http://localhost:3000/api/mcp` with curl: `curl -i -H "Authorization: Bearer wrong" http://localhost:3000/api/mcp` → expect 401.
- Visit `http://localhost:3000/api/setup` → expect HTML form.
- Stop with Ctrl+C.

(Skip if you don't have `vercel` CLI installed; full validation happens after deploy in Task 21 below.)

- [ ] **Step 6: Verify `.gitignore` is doing its job**

Run:
```bash
ls -la .env.local 2>/dev/null && git check-ignore -v .env.local
```
Expected: file exists (from Task 16's setup.sh run) and `.gitignore:9:.env.local  .env.local` (or similar) — confirming it's ignored.

- [ ] **Step 7: Spec → plan coverage check**

Open `docs/superpowers/specs/2026-05-09-vercel-connector-design.md` side-by-side with this plan. For each spec section (Architecture, File changes, Data flow, Token storage, Connector authentication, OAuth flow security, setup.sh changes, README + docs, .gitignore, Test strategy), confirm at least one task implemented it. If anything's missing, add a follow-up task and re-run this checklist.

- [ ] **Step 8: No commit needed (verification only)**

If everything passes, the implementation is complete and ready for deploy/merge.

---

## Self-review notes (filled by writer)

Performed before handoff:

1. **Spec coverage** — Spec sections mapped:
   - Architecture (entry points, shared modules) → Tasks 6, 7, 11
   - File changes → Tasks 3, 5, 6, 11–15
   - Data flow (Vercel mode) → Tasks 11, 12, 13
   - Token storage abstraction → Tasks 3, 5
   - Connector authentication (timing-safe bearer) → Task 10
   - OAuth flow security (state cookie, no token in URL) → Tasks 12, 13
   - setup.sh changes → Task 16
   - README + open-source ergonomics → Task 18
   - .gitignore → Task 1
   - Test strategy → Tasks 3, 5, 10
   - AGENTS.md (CLAUDE.md) update → Task 19

2. **Placeholder scan** — No "TBD", "implement later", or undefined function references. Tools-extraction task (Task 6) describes a mechanical move rather than enumerating 36 tools inline; this is intentional and unambiguous.

3. **Type consistency** — `StoredTokens` defined once in `src/token-store.ts` and consumed everywhere. `TokenStore` interface stable across tasks. `loadClientCredentialsFromFile` returns `ClientCredentials`, consumed by `getAuthenticatedClient` and `authorizeViaLocalServer`. `checkBearer` signature stable across `api/mcp.ts` and `api/setup.ts`.
