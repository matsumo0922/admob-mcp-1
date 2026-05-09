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
