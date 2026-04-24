import { describe, expect, it } from "vitest";
import { assertEnv, parseCsv, ttlMs } from "../../src/env";

describe("assertEnv", () => {
  const full = {
    GITHUB_REPO: "a/b",
    GITHUB_BRANCH: "main",
    WIKI_SERVER_NAME: "wiki",
    CACHE_TTL_SECONDS: "60",
    SCHEMA_GLOBS: "CLAUDE.md",
    DOMAIN_REQUIRED_FILES: "index.md,log.md",
    MCP_BEARER: "bearer",
    GITHUB_TOKEN: "pat",
  };

  it("passes when all required keys present", () => {
    expect(() => assertEnv({ ...full })).not.toThrow();
  });

  it("throws listing every missing required key", () => {
    const partial = { ...full, MCP_BEARER: undefined, GITHUB_TOKEN: undefined };
    expect(() => assertEnv(partial)).toThrowError(/MCP_BEARER.*GITHUB_TOKEN/);
  });

  it("treats empty string as missing", () => {
    expect(() => assertEnv({ ...full, GITHUB_REPO: "" })).toThrowError(/GITHUB_REPO/);
  });

  it("does not require MCP_BEARER_NEXT (optional rotation slot)", () => {
    expect(() => assertEnv({ ...full })).not.toThrow();
  });
});

describe("parseCsv", () => {
  it("splits, trims, and drops empties", () => {
    expect(parseCsv(" a , b,,c ")).toEqual(["a", "b", "c"]);
  });
});

describe("ttlMs", () => {
  it("converts seconds to ms", () => {
    expect(ttlMs({ CACHE_TTL_SECONDS: "30" } as never)).toBe(30_000);
  });

  it("falls back to 60s default on non-numeric", () => {
    expect(ttlMs({ CACHE_TTL_SECONDS: "xxx" } as never)).toBe(60_000);
  });

  it("falls back to 60s default on zero or negative", () => {
    expect(ttlMs({ CACHE_TTL_SECONDS: "0" } as never)).toBe(60_000);
    expect(ttlMs({ CACHE_TTL_SECONDS: "-5" } as never)).toBe(60_000);
  });
});
