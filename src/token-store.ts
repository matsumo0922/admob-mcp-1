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
      const content = await fs.promises.readFile(this.path, "utf-8");
      return JSON.parse(content) as StoredTokens;
    } catch {
      return null;
    }
  }

  async save(tokens: StoredTokens): Promise<void> {
    await fs.promises.writeFile(this.path, JSON.stringify(tokens, null, 2));
  }
}

export class KvTokenStore implements TokenStore {
  private static readonly KEY = "admob:tokens";

  async load(): Promise<StoredTokens | null> {
    const { kv } = await import("@vercel/kv");
    return (await kv.get<StoredTokens>(KvTokenStore.KEY)) ?? null;
  }

  async save(tokens: StoredTokens): Promise<void> {
    const { kv } = await import("@vercel/kv");
    await kv.set(KvTokenStore.KEY, tokens);
  }
}
