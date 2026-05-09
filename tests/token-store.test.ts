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
