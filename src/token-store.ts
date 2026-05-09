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
