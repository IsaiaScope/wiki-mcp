import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env";
import { buildPrime } from "../../src/prime";
import type { Domain, Snapshot } from "../../src/types";

function makeSnapshot(
  domains: Record<string, Record<string, string[]>>,
  sha = "deadbeef",
): Snapshot {
  const map = new Map<string, Domain>();
  for (const [name, types] of Object.entries(domains)) {
    const wikiTypes = new Map<string, string[]>();
    for (const [t, slugs] of Object.entries(types)) {
      wikiTypes.set(
        t,
        slugs.map((s) => `${name}/wiki/${t}/${s}.md`),
      );
    }
    map.set(name, {
      name,
      indexPath: `${name}/index.md`,
      logPath: `${name}/log.md`,
      wikiTypes,
      rawPaths: [],
    });
  }
  return { sha, fetchedAt: 0, domains: map, allPaths: [], schemaPaths: [] };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GITHUB_REPO: "a/b",
    GITHUB_BRANCH: "main",
    WIKI_SERVER_NAME: "testwiki",
    CACHE_TTL_SECONDS: "60",
    SCHEMA_GLOBS: "",
    DOMAIN_REQUIRED_FILES: "",
    MCP_BEARER: "x",
    GITHUB_TOKEN: "x",
    ...overrides,
  };
}

describe("buildPrime — structural (default)", () => {
  it("returns a bundle with vocabMode='structural' when env unset", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } });
    const p = buildPrime(snap, makeEnv());
    expect(p.vocabMode).toBe("structural");
  });

  it("instructions mention server name, domains, types, counts", () => {
    const snap = makeSnapshot({
      personal: { entities: ["Foo", "Bar"], concepts: ["tfr"] },
      work: { entities: ["Qux"] },
    });
    const p = buildPrime(snap, makeEnv());
    expect(p.instructions).toContain("testwiki");
    expect(p.instructions).toContain("personal");
    expect(p.instructions).toContain("work");
    expect(p.instructions).toContain("entities");
    expect(p.instructions).toContain("concepts");
    // counts
    expect(p.instructions).toMatch(/personal.*3/s);
    expect(p.instructions).toMatch(/work.*1/s);
  });

  it("instructions do NOT contain any page title under structural", () => {
    const snap = makeSnapshot({
      personal: { entities: ["Fincons", "Agrati"], concepts: ["tfr"] },
    });
    const p = buildPrime(snap, makeEnv());
    expect(p.instructions).not.toContain("Fincons");
    expect(p.instructions).not.toContain("Agrati");
    expect(p.instructions).not.toContain("TFR");
  });

  it("tool descriptions do NOT contain page titles under structural", () => {
    const snap = makeSnapshot({ personal: { entities: ["Fincons"] } });
    const p = buildPrime(snap, makeEnv());
    for (const desc of Object.values(p.toolDescriptions)) {
      expect(desc).not.toContain("Fincons");
    }
  });

  it("tool descriptions mention wiki://overview in wiki_context", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } });
    const p = buildPrime(snap, makeEnv());
    expect(p.toolDescriptions.wiki_context).toContain("wiki://overview");
  });

  it("prepends greeting when WIKI_PRIME_GREETING set, trims whitespace", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_GREETING: "  Riva's wiki.  " }));
    expect(p.instructions).toContain("Riva's wiki.");
  });

  it("omits greeting section when env var empty or unset", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_GREETING: "" }));
    // a sane "no greeting" output should not start with two newlines / empty greeting
    expect(p.instructions.startsWith("\n\n")).toBe(false);
  });

  it("captures snapshot sha in bundle for lockstep invariant", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } }, "abc123");
    const p = buildPrime(snap, makeEnv());
    expect(p.sha).toBe("abc123");
  });

  it("empty snapshot (zero domains) still produces a valid bundle with guidance", () => {
    const snap = makeSnapshot({});
    const p = buildPrime(snap, makeEnv());
    expect(p.instructions).toContain("no wiki domains");
    expect(p.instructions).toContain("DOMAIN_REQUIRED_FILES");
    expect(p.vocabMode).toBe("structural");
  });

  it("domain with zero pages is listed as (empty)", () => {
    const snap = makeSnapshot({ work: {} });
    const p = buildPrime(snap, makeEnv());
    expect(p.instructions).toMatch(/work.*\(empty\)/s);
  });

  it("is deterministic: same inputs → byte-identical instructions", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo", "Bar"] } });
    const a = buildPrime(snap, makeEnv());
    const b = buildPrime(snap, makeEnv());
    expect(a.instructions).toBe(b.instructions);
    expect(JSON.stringify(Array.from(a.overviewByDomain.entries()))).toBe(
      JSON.stringify(Array.from(b.overviewByDomain.entries())),
    );
  });
});

describe("buildPrime — full (opt-in vocab)", () => {
  it("vocabMode reported as 'full'", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "full" }));
    expect(p.vocabMode).toBe("full");
  });

  it("instructions contain prettified titles", () => {
    const snap = makeSnapshot({
      personal: { entities: ["Fincons S.p.A.", "ccnl-metalmeccanico"] },
    });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "full" }));
    expect(p.instructions).toContain("Fincons S.p.A.");
    expect(p.instructions).toContain("CCNL Metalmeccanico");
  });

  it("wiki_context description contains trigger vocabulary", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo", "Bar"] } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "full" }));
    expect(p.toolDescriptions.wiki_context).toContain("Foo");
    expect(p.toolDescriptions.wiki_context).toContain("Bar");
  });

  it("instructions trigger list capped at 50 titles, alphabetical", () => {
    const many = Array.from({ length: 80 }, (_, i) => `page-${String(i).padStart(3, "0")}`);
    const snap = makeSnapshot({ personal: { entities: many } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "full" }));
    // alphabetical: page-000 first, page-049 last of included
    expect(p.instructions).toContain("Page 000");
    expect(p.instructions).toContain("Page 049");
    expect(p.instructions).not.toContain("Page 050");
    expect(p.instructions).toMatch(/and \d+ more/);
  });

  it("tool description trigger list capped at 30 titles", () => {
    const many = Array.from({ length: 50 }, (_, i) => `page-${String(i).padStart(3, "0")}`);
    const snap = makeSnapshot({ personal: { entities: many } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "full" }));
    const desc = p.toolDescriptions.wiki_context;
    expect(desc).toContain("Page 000");
    expect(desc).toContain("Page 029");
    expect(desc).not.toContain("Page 030");
  });

  it("title collision across domains kept once in trigger list (dedupe)", () => {
    const snap = makeSnapshot({
      personal: { entities: ["Foo"] },
      work: { entities: ["Foo"] },
    });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "full" }));
    const occurrences = (p.instructions.match(/Foo/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe("buildPrime — off (opt-out)", () => {
  it("vocabMode reported as 'off'", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "off" }));
    expect(p.vocabMode).toBe("off");
  });

  it("instructions are a minimal one-liner", () => {
    const snap = makeSnapshot({ personal: { entities: ["Fincons"] } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "off" }));
    expect(p.instructions).toContain("Call wiki_context");
    expect(p.instructions).not.toContain("Domains discovered");
    expect(p.instructions).not.toContain("Fincons");
  });

  it("tool descriptions revert to the static strings", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "off" }));
    expect(p.toolDescriptions.wiki_context).not.toContain("wiki://overview");
    expect(p.toolDescriptions.wiki_context).not.toContain("Trigger vocabulary");
    expect(p.toolDescriptions.wiki_search).toBe(
      "Explicit keyword search over wiki metadata. Returns ranked {path,title,snippet,score}.",
    );
  });

  it("overview bodies note suppression", () => {
    const snap = makeSnapshot({ personal: { entities: ["Foo"] } });
    const p = buildPrime(snap, makeEnv({ WIKI_PRIME_VOCAB: "off" }));
    expect(p.overviewIndex).toContain("suppressed by WIKI_PRIME_VOCAB=off");
    expect(p.overviewByDomain.get("personal")).toContain("suppressed");
  });
});
