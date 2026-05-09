import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileTokenStore, KvTokenStore, type StoredTokens } from "../src/token-store";

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
