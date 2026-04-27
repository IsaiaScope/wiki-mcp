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

import { parseVocabMode } from "../../src/env";

describe("parseVocabMode", () => {
  it("returns 'structural' as the default when input is undefined", () => {
    expect(parseVocabMode(undefined)).toBe("structural");
  });

  it("returns 'structural' for empty string", () => {
    expect(parseVocabMode("")).toBe("structural");
  });

  it("returns the three canonical values verbatim", () => {
    expect(parseVocabMode("structural")).toBe("structural");
    expect(parseVocabMode("full")).toBe("full");
    expect(parseVocabMode("off")).toBe("off");
  });

  it("falls back to 'structural' on unknown value (typo-safe, no throw)", () => {
    expect(parseVocabMode("Full")).toBe("structural");
    expect(parseVocabMode("verbose")).toBe("structural");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseVocabMode("  full  ")).toBe("full");
  });
});

import { maxUploadBytes, rawFolder } from "../../src/env";

describe("maxUploadBytes", () => {
  it("parses numeric string to bytes", () => {
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: "1048576" } as never)).toBe(1_048_576);
  });

  it("falls back to 25 MB default on non-numeric", () => {
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: "xxx" } as never)).toBe(26_214_400);
  });

  it("falls back to 25 MB default on zero or negative", () => {
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: "0" } as never)).toBe(26_214_400);
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: "-5" } as never)).toBe(26_214_400);
  });

  it("falls back to 25 MB default when field absent", () => {
    expect(maxUploadBytes({} as never)).toBe(26_214_400);
  });
});

describe("rawFolder", () => {
  it("returns configured folder name", () => {
    expect(rawFolder({ RAW_FOLDER: "raw" } as never)).toBe("raw");
    expect(rawFolder({ RAW_FOLDER: "assets" } as never)).toBe("assets");
  });

  it("falls back to 'raw' default when empty or absent", () => {
    expect(rawFolder({ RAW_FOLDER: "" } as never)).toBe("raw");
    expect(rawFolder({} as never)).toBe("raw");
  });

  it("trims whitespace and rejects path separators", () => {
    expect(rawFolder({ RAW_FOLDER: "  raw  " } as never)).toBe("raw");
    expect(rawFolder({ RAW_FOLDER: "raw/data" } as never)).toBe("raw");
    expect(rawFolder({ RAW_FOLDER: "../raw" } as never)).toBe("raw");
  });
});

describe("assertEnv — optional priming vars", () => {
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

  it("does not require WIKI_PRIME_VOCAB", () => {
    expect(() => assertEnv({ ...full })).not.toThrow();
  });

  it("does not require WIKI_PRIME_GREETING", () => {
    expect(() => assertEnv({ ...full })).not.toThrow();
  });

  it("accepts both priming vars when set", () => {
    expect(() =>
      assertEnv({ ...full, WIKI_PRIME_VOCAB: "full", WIKI_PRIME_GREETING: "hi" }),
    ).not.toThrow();
  });
});
