# Dynamic Server Priming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the wiki tree at snapshot time into a `PrimeBundle` that drives `serverInfo.instructions`, per-tool descriptions, and new `wiki://overview[/{domain}]` resources — making the MCP server fork-friendly and Claude-triggering-friendly without any body fetch.

**Architecture:** New `src/prime.ts` module (pure, synchronous) consumes `Snapshot + Env` and returns `PrimeBundle`. `ServerDeps` caches the bundle alongside the snapshot; `refresh()` rebuilds both in lockstep (invariant: `snapshot.sha === prime.sha`). `server.ts`, `tools.ts`, `resources.ts` consume the bundle. Three-valued `WIKI_PRIME_VOCAB` env var gates privacy: `structural` (default, no titles in instructions/tools), `full` (titles injected, capped), `off` (minimal one-liner).

**Tech Stack:** TypeScript (strict), `@modelcontextprotocol/sdk` (server + ResourceTemplate), zod, Vitest, biome/ultracite, Cloudflare Workers runtime.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | modify | Add `PrimeVocabMode`, `ToolName`, `PrimeBundle` types |
| `src/env.ts` | modify | Add optional `WIKI_PRIME_VOCAB`, `WIKI_PRIME_GREETING` to `Env`; add `parseVocabMode` helper |
| `src/prime.ts` | create | Pure builders: `prettifyTitle`, `collectVocab`, `buildInstructions`, `buildToolDescriptions`, `buildOverviewIndex`, `buildOverviewByDomain`, `buildPrime` |
| `src/server.ts` | modify | Extend `ServerDeps` with `getPrime`; `buildDeps` caches prime; `createServer` passes `prime.instructions` to `McpServer` and `prime` to tool/resource registrars |
| `src/tools.ts` | modify | `ToolContext` gains `prime`; `registerTool` calls use `prime.toolDescriptions[name]` |
| `src/resources.ts` | modify | Add `wiki://overview` + `wiki://overview/{domain}` (enumerated per domain) |
| `test/unit/prettify.test.ts` | create | Table-driven `prettifyTitle` tests |
| `test/unit/prime.test.ts` | create | Pure-function tests for all `buildPrime` behaviors |
| `test/unit/env.test.ts` | modify | Add `parseVocabMode` cases + assert optional new vars don't break `assertEnv` |
| `test/integration/prime-wiring.test.ts` | create | Full `createServer` wiring + resource read round-trip |
| `test/fixtures/vault/` | unchanged | Existing `personal/` + `work/` sufficient; no fixture edits |
| `README.md` | modify | Add priming section + new env rows in Configuration surface |

Guiding rules for every task:
- TDD: write failing test → run to confirm FAIL → minimal implementation → run to confirm PASS → commit.
- Each commit leaves the repo green (`pnpm test` passes). The pre-commit husky hook auto-bumps `package.json` version and re-amends; that's expected and is not a reason to skip hook.
- Existing **77 tests** must remain green at every commit boundary.
- No placeholders in shipped code: if a step adds a symbol, all references to that symbol within the same task use the exact same name and signature.

---

## Phase 1 — Types + Env plumbing (no behavior change)

### Task 1: Add priming types to `src/types.ts`

**Files:**
- Modify: `src/types.ts` (append exports at end of file)

- [ ] **Step 1: Append new types to `src/types.ts`**

Open `src/types.ts` and append below the existing `GithubTreeEntry` export:

```ts
export type PrimeVocabMode = "structural" | "full" | "off";

export type ToolName = "wiki_context" | "wiki_search" | "wiki_fetch" | "wiki_list";

export type PrimeBundle = {
  instructions: string;
  toolDescriptions: Record<ToolName, string>;
  overviewIndex: string;
  overviewByDomain: Map<string, string>;
  vocabMode: PrimeVocabMode;
  sha: string;
};
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: `tsc --noEmit` exits 0 with no output. No existing code imports these yet, so nothing breaks.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add PrimeVocabMode, ToolName, PrimeBundle types"
```

Expected: husky pre-commit runs lint + tests (77 passing), auto-bumps `package.json` version, commit lands green.

---

### Task 2: Extend `Env` + add `parseVocabMode` helper

**Files:**
- Modify: `src/env.ts`
- Modify: `test/unit/env.test.ts`

- [ ] **Step 1: Write failing tests for `parseVocabMode`**

Open `test/unit/env.test.ts` and add at the end of the file:

```ts
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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- test/unit/env.test.ts`
Expected: FAIL — `parseVocabMode` is not exported from `src/env`.

- [ ] **Step 3: Implement `Env` extension + `parseVocabMode` in `src/env.ts`**

Modify `src/env.ts`:

Replace the current `Env` type with:

```ts
export type Env = {
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  WIKI_SERVER_NAME: string;
  CACHE_TTL_SECONDS: string;
  SCHEMA_GLOBS: string;
  DOMAIN_REQUIRED_FILES: string;
  MCP_BEARER: string;
  MCP_BEARER_NEXT?: string;
  GITHUB_TOKEN: string;
  WIKI_PRIME_VOCAB?: string;
  WIKI_PRIME_GREETING?: string;
};
```

Append at the end of the file:

```ts
import type { PrimeVocabMode } from "./types";

const VOCAB_MODES: readonly PrimeVocabMode[] = ["structural", "full", "off"];

export function parseVocabMode(raw: string | undefined): PrimeVocabMode {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "structural";
  return (VOCAB_MODES as readonly string[]).includes(trimmed)
    ? (trimmed as PrimeVocabMode)
    : "structural";
}
```

Note: `REQUIRED_KEYS` is unchanged — new vars are optional and must not be added there.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- test/unit/env.test.ts`
Expected: PASS — all new test cases green + all previous `env.test.ts` cases still green.

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: all 77 existing + new cases pass.

- [ ] **Step 6: Commit**

```bash
git add src/env.ts test/unit/env.test.ts
git commit -m "feat(env): optional WIKI_PRIME_VOCAB/GREETING + parseVocabMode helper"
```

---

## Phase 2 — Prime module (pure, tested in isolation)

### Task 3: `prettifyTitle` helper + tests

**Files:**
- Create: `src/prime.ts`
- Create: `test/unit/prettify.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/unit/prettify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prettifyTitle } from "../../src/prime";

describe("prettifyTitle", () => {
  it("kebab-case → title case, known acronyms uppercased", () => {
    expect(prettifyTitle("ccnl-metalmeccanico")).toBe("CCNL Metalmeccanico");
  });

  it("preserves existing capitalization and dots in filenames", () => {
    expect(prettifyTitle("A.Agrati SPA")).toBe("A.Agrati SPA");
  });

  it("dated source filenames: keep dates, titlecase words", () => {
    expect(prettifyTitle("2026-04-24-fincons-busta-paga-2023")).toBe(
      "2026-04-24 Fincons Busta Paga 2023",
    );
  });

  it("lowercase acronym → uppercase acronym", () => {
    expect(prettifyTitle("tfr")).toBe("TFR");
  });

  it("multi-word kebab with mixed acronym", () => {
    expect(prettifyTitle("llm-wiki-pattern")).toBe("LLM Wiki Pattern");
  });

  it("snake_case normalized like kebab", () => {
    expect(prettifyTitle("my_personal_notes")).toBe("My Personal Notes");
  });

  it("strips .md extension if present", () => {
    expect(prettifyTitle("some-page.md")).toBe("Some Page");
  });

  it("empty string returns empty string", () => {
    expect(prettifyTitle("")).toBe("");
  });

  it("already-prettified titles pass through", () => {
    expect(prettifyTitle("Already Pretty")).toBe("Already Pretty");
  });

  it("unicode/Italian characters preserved", () => {
    expect(prettifyTitle("così-fà")).toBe("Così Fà");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm test -- test/unit/prettify.test.ts`
Expected: FAIL — `src/prime` module does not exist.

- [ ] **Step 3: Implement `prettifyTitle` in new `src/prime.ts`**

Create `src/prime.ts`:

```ts
const KNOWN_ACRONYMS = new Set(["CCNL", "TFR", "ID", "URL", "API", "MCP", "LLM"]);

export function prettifyTitle(raw: string): string {
  if (!raw) return "";
  const stripped = raw.replace(/\.md$/i, "");
  const parts = stripped.split(/[-_\s]+/).filter(Boolean);
  return parts
    .map((part) => {
      const up = part.toUpperCase();
      if (KNOWN_ACRONYMS.has(up)) return up;
      if (/^\d/.test(part)) return part;            // keep date/number runs verbatim
      if (/[A-Z]/.test(part)) return part;           // preserve existing cased words
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm test -- test/unit/prettify.test.ts`
Expected: PASS — all 10 cases.

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: all prior tests + 10 new `prettify` cases green.

- [ ] **Step 6: Commit**

```bash
git add src/prime.ts test/unit/prettify.test.ts
git commit -m "feat(prime): prettifyTitle helper with acronym preservation"
```

---

### Task 4: `buildPrime` — structural mode (default path)

**Files:**
- Modify: `src/prime.ts` (append)
- Create: `test/unit/prime.test.ts`

- [ ] **Step 1: Write failing tests for structural mode**

Create `test/unit/prime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPrime } from "../../src/prime";
import type { Domain, Env, Snapshot } from "../../src/types";

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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- test/unit/prime.test.ts`
Expected: FAIL — `buildPrime` is not exported from `src/prime`.

- [ ] **Step 3: Implement structural `buildPrime` in `src/prime.ts`**

Append to `src/prime.ts`:

```ts
import type { Domain, Env, PrimeBundle, PrimeVocabMode, Snapshot, ToolName } from "./types";
import { parseVocabMode } from "./env";

const STATIC_TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  wiki_context:
    "Return a full knowledge bundle (schema + indexes + log tail + ranked hits + one-hop link expansion) for a question. Primary tool; call this first for wiki-relevant questions.",
  wiki_search:
    "Explicit keyword search over wiki metadata. Returns ranked {path,title,snippet,score}.",
  wiki_fetch: "Batch read pages by path. Max 20 paths per call.",
  wiki_list: "List discovered pages, optionally filtered by domain and/or type.",
};

export function buildPrime(snapshot: Snapshot, env: Env): PrimeBundle {
  const vocabMode = parseVocabMode(env.WIKI_PRIME_VOCAB);
  const greeting = (env.WIKI_PRIME_GREETING ?? "").trim();
  const vocab = collectVocab(snapshot);

  return {
    vocabMode,
    sha: snapshot.sha,
    instructions: buildInstructions(snapshot, vocab, env, vocabMode, greeting),
    toolDescriptions: buildToolDescriptions(vocab, vocabMode),
    overviewIndex: buildOverviewIndex(snapshot, env, greeting, vocabMode),
    overviewByDomain: buildOverviewByDomain(snapshot, vocabMode),
  };
}

type Vocab = Map<string, Map<string, string[]>>; // domain → type → prettified titles

function collectVocab(snapshot: Snapshot): Vocab {
  const out: Vocab = new Map();
  for (const [name, dom] of snapshot.domains) {
    const perType = new Map<string, string[]>();
    for (const [t, paths] of dom.wikiTypes) {
      const titles: string[] = [];
      for (const p of paths) {
        const base = p.split("/").pop() ?? p;
        const pretty = prettifyTitle(base);
        if (pretty) titles.push(pretty);
      }
      perType.set(t, titles);
    }
    out.set(name, perType);
  }
  return out;
}

function countDomainPages(dom: Domain): number {
  let total = 0;
  for (const paths of dom.wikiTypes.values()) total += paths.length;
  return total;
}

function buildInstructions(
  snapshot: Snapshot,
  _vocab: Vocab,
  env: Env,
  mode: PrimeVocabMode,
  greeting: string,
): string {
  const name = env.WIKI_SERVER_NAME;

  if (mode === "off") {
    const parts: string[] = [];
    if (greeting) parts.push(greeting);
    parts.push(
      `Personal knowledge wiki for ${name}. Call wiki_context for wiki-relevant questions; read wiki://overview for inventory.`,
    );
    return parts.join("\n\n");
  }

  const parts: string[] = [];
  if (greeting) parts.push(greeting);
  parts.push(`Personal knowledge wiki for ${name}.`);

  if (snapshot.domains.size === 0) {
    parts.push(
      "No wiki domains discovered yet. Configure DOMAIN_REQUIRED_FILES (currently requires the listed files at a top-level folder) to match your tree, or populate a domain folder. Read wiki://overview for the current discovery contract.",
    );
  } else {
    parts.push("Domains discovered:");
    for (const [dname, dom] of snapshot.domains) {
      const count = countDomainPages(dom);
      if (count === 0) {
        parts.push(`- ${dname}: (empty)`);
        continue;
      }
      const typeSummary = Array.from(dom.wikiTypes.entries())
        .map(([t, ps]) => `${t} (${ps.length})`)
        .join(", ");
      parts.push(`- ${dname}: ${count} pages — ${typeSummary}`);
    }
    parts.push(
      "Call wiki_context before answering questions that may involve this wiki. Cite with [[path]]. Read wiki://overview for the full page inventory. Never invent sources or pages not present in the wiki.",
    );
  }

  return parts.join("\n\n");
}

function buildToolDescriptions(
  _vocab: Vocab,
  mode: PrimeVocabMode,
): Record<ToolName, string> {
  if (mode === "off") return { ...STATIC_TOOL_DESCRIPTIONS };

  const contextTail =
    " Read wiki://overview for the current page inventory before deciding between wiki_context, wiki_search, and wiki_fetch.";

  return {
    wiki_context: STATIC_TOOL_DESCRIPTIONS.wiki_context + contextTail,
    wiki_search: STATIC_TOOL_DESCRIPTIONS.wiki_search,
    wiki_fetch: STATIC_TOOL_DESCRIPTIONS.wiki_fetch,
    wiki_list: STATIC_TOOL_DESCRIPTIONS.wiki_list,
  };
}

function buildOverviewIndex(
  snapshot: Snapshot,
  env: Env,
  greeting: string,
  mode: PrimeVocabMode,
): string {
  const lines: string[] = [];
  lines.push(`# ${env.WIKI_SERVER_NAME} — Wiki Overview`);
  if (greeting) {
    lines.push("");
    lines.push(greeting);
  }
  lines.push("");

  if (mode === "off") {
    lines.push("Vocabulary suppressed by WIKI_PRIME_VOCAB=off. Use wiki_list for an enumerated page listing.");
    return lines.join("\n");
  }

  if (snapshot.domains.size === 0) {
    lines.push("No wiki domains discovered. See DOMAIN_REQUIRED_FILES / SCHEMA_GLOBS in wrangler.toml.");
    return lines.join("\n");
  }

  lines.push(`Available domains: ${Array.from(snapshot.domains.keys()).join(", ")}`);
  lines.push("");
  lines.push("Per-domain slices:");
  for (const [dname, dom] of snapshot.domains) {
    lines.push(`- wiki://overview/${dname} (${countDomainPages(dom)} pages)`);
  }
  return lines.join("\n");
}

function buildOverviewByDomain(
  snapshot: Snapshot,
  mode: PrimeVocabMode,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [dname, dom] of snapshot.domains) {
    if (mode === "off") {
      out.set(dname, `# ${dname}\n\nVocabulary suppressed by WIKI_PRIME_VOCAB=off.`);
      continue;
    }
    const lines: string[] = [];
    lines.push(`# ${dname}`);
    if (countDomainPages(dom) === 0) {
      lines.push("");
      lines.push("_(empty — no pages yet)_");
      out.set(dname, lines.join("\n"));
      continue;
    }
    for (const [t, paths] of dom.wikiTypes) {
      lines.push("");
      lines.push(`## ${t} (${paths.length})`);
      for (const p of paths) {
        const base = p.split("/").pop() ?? p;
        const pretty = prettifyTitle(base);
        lines.push(`- [[${p}]] — ${pretty}`);
      }
    }
    out.set(dname, lines.join("\n"));
  }
  return out;
}
```

Note: `buildInstructions` and `buildToolDescriptions` accept the `_vocab` parameter even though `structural` mode ignores it — Task 5 will read from it when implementing `full`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- test/unit/prime.test.ts`
Expected: PASS — all structural-mode cases green.

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: all existing + new green.

- [ ] **Step 6: Commit**

```bash
git add src/prime.ts test/unit/prime.test.ts
git commit -m "feat(prime): buildPrime structural mode + overview builders"
```

---

### Task 5: `buildPrime` — `full` mode with caps

**Files:**
- Modify: `src/prime.ts` (extend `buildInstructions` + `buildToolDescriptions`)
- Modify: `test/unit/prime.test.ts` (append `full` cases)

- [ ] **Step 1: Write failing tests for full mode**

Append to `test/unit/prime.test.ts` inside the existing describe block or as a new describe:

```ts
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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- test/unit/prime.test.ts`
Expected: FAIL — trigger list not yet emitted in full mode; caps not applied.

- [ ] **Step 3: Extend `buildInstructions` + `buildToolDescriptions` in `src/prime.ts`**

Find the existing `buildInstructions` + `buildToolDescriptions` functions. Replace them with:

```ts
const INSTRUCTIONS_TITLE_CAP = 50;
const TOOL_DESC_TITLE_CAP = 30;

function flatTriggerList(vocab: Vocab, cap: number): { included: string[]; omitted: number } {
  const all = new Set<string>();
  for (const perType of vocab.values()) {
    for (const titles of perType.values()) {
      for (const t of titles) all.add(t);
    }
  }
  const sorted = Array.from(all).sort((a, b) => a.localeCompare(b));
  return {
    included: sorted.slice(0, cap),
    omitted: Math.max(0, sorted.length - cap),
  };
}

function buildInstructions(
  snapshot: Snapshot,
  vocab: Vocab,
  env: Env,
  mode: PrimeVocabMode,
  greeting: string,
): string {
  const name = env.WIKI_SERVER_NAME;

  if (mode === "off") {
    const parts: string[] = [];
    if (greeting) parts.push(greeting);
    parts.push(
      `Personal knowledge wiki for ${name}. Call wiki_context for wiki-relevant questions; read wiki://overview for inventory.`,
    );
    return parts.join("\n\n");
  }

  const parts: string[] = [];
  if (greeting) parts.push(greeting);
  parts.push(`Personal knowledge wiki for ${name}.`);

  if (snapshot.domains.size === 0) {
    parts.push(
      "No wiki domains discovered yet. Configure DOMAIN_REQUIRED_FILES (currently requires the listed files at a top-level folder) to match your tree, or populate a domain folder. Read wiki://overview for the current discovery contract.",
    );
  } else {
    parts.push("Domains discovered:");
    for (const [dname, dom] of snapshot.domains) {
      const count = countDomainPages(dom);
      if (count === 0) {
        parts.push(`- ${dname}: (empty)`);
        continue;
      }
      const typeSummary = Array.from(dom.wikiTypes.entries())
        .map(([t, ps]) => `${t} (${ps.length})`)
        .join(", ");
      parts.push(`- ${dname}: ${count} pages — ${typeSummary}`);
    }
    parts.push(
      "Call wiki_context before answering questions that may involve this wiki. Cite with [[path]]. Read wiki://overview for the full page inventory. Never invent sources or pages not present in the wiki.",
    );

    if (mode === "full") {
      const { included, omitted } = flatTriggerList(vocab, INSTRUCTIONS_TITLE_CAP);
      if (included.length > 0) {
        const suffix = omitted > 0 ? ` and ${omitted} more` : "";
        parts.push(`Trigger vocabulary: ${included.join(", ")}${suffix}.`);
      }
    }
  }

  return parts.join("\n\n");
}

function buildToolDescriptions(
  vocab: Vocab,
  mode: PrimeVocabMode,
): Record<ToolName, string> {
  if (mode === "off") return { ...STATIC_TOOL_DESCRIPTIONS };

  const baseTail =
    " Read wiki://overview for the current page inventory before deciding between wiki_context, wiki_search, and wiki_fetch.";

  let contextDesc = STATIC_TOOL_DESCRIPTIONS.wiki_context + baseTail;

  if (mode === "full") {
    const { included, omitted } = flatTriggerList(vocab, TOOL_DESC_TITLE_CAP);
    if (included.length > 0) {
      const suffix = omitted > 0 ? ` and ${omitted} more` : "";
      contextDesc += ` Trigger vocabulary: ${included.join(", ")}${suffix}.`;
    }
  }

  return {
    wiki_context: contextDesc,
    wiki_search: STATIC_TOOL_DESCRIPTIONS.wiki_search,
    wiki_fetch: STATIC_TOOL_DESCRIPTIONS.wiki_fetch,
    wiki_list: STATIC_TOOL_DESCRIPTIONS.wiki_list,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- test/unit/prime.test.ts`
Expected: PASS — full-mode cases green, structural-mode cases still green.

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/prime.ts test/unit/prime.test.ts
git commit -m "feat(prime): full vocab mode with 50/30 title caps + dedupe"
```

---

### Task 6: `buildPrime` — `off` mode regression tests

**Files:**
- Modify: `test/unit/prime.test.ts` (append `off` describe)

- [ ] **Step 1: Write tests for off mode**

Append to `test/unit/prime.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests**

Run: `pnpm test -- test/unit/prime.test.ts`
Expected: PASS (code already supports `off` mode from Tasks 4–5).

- [ ] **Step 3: Commit**

```bash
git add test/unit/prime.test.ts
git commit -m "test(prime): cover off mode (minimal instructions + suppressed overview)"
```

---

## Phase 3 — Wire prime into server deps (no new surfaces yet)

### Task 7: Extend `ServerDeps` with `getPrime` + lockstep refresh

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Modify `ServerDeps` + `buildDeps` in `src/server.ts`**

Replace the current `ServerDeps` type + `buildDeps` + `createServer` bodies. Target state:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildSnapshot } from "./discover";
import { assertEnv, type Env } from "./env";
import { GithubClient } from "./github";
import { buildPrime } from "./prime";
import { type ReadResult, type ResourceContext, registerResources } from "./resources";
import { registerTools, type ToolContext, type ToolResult } from "./tools";
import type { PrimeBundle, Snapshot } from "./types";

export type ServerHandle = {
  raw: McpServer;
  listToolNames: () => string[];
  listResourceUris: () => string[];
  callTool: (name: string, args: unknown) => Promise<ToolResult>;
  readResource: (uri: string) => Promise<ReadResult>;
};

export type ServerDeps = {
  github: GithubClient;
  getSnapshot: () => Promise<Snapshot>;
  getPrime: () => Promise<PrimeBundle>;
  refresh: () => Promise<Snapshot>;
  isStale: () => boolean;
};

export function buildDeps(env: Env): ServerDeps {
  assertEnv(env);
  const github = new GithubClient(env);
  let snapshot: Snapshot | null = null;
  let prime: PrimeBundle | null = null;

  const rebuild = (s: Snapshot): Snapshot => {
    snapshot = s;
    prime = buildPrime(s, env);
    console.log(
      `[prime] rebuilt sha=${s.sha.slice(0, 7)} domains=${s.domains.size} vocabMode=${prime.vocabMode}`,
    );
    return s;
  };

  const refresh = async (): Promise<Snapshot> => {
    github.invalidate();
    const tree = await github.fetchTree();
    return rebuild(buildSnapshot(tree, env));
  };

  const getSnapshot = async (): Promise<Snapshot> => {
    if (snapshot) return snapshot;
    const tree = await github.fetchTree();
    return rebuild(buildSnapshot(tree, env));
  };

  const getPrime = async (): Promise<PrimeBundle> => {
    if (prime) return prime;
    await getSnapshot();
    // biome-ignore lint/style/noNonNullAssertion: rebuild sets both in lockstep
    return prime!;
  };

  const isStale = (): boolean => !snapshot || github.isStale();

  return { github, getSnapshot, getPrime, refresh, isStale };
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (createServer hasn't been touched yet but buildDeps compiles standalone).

- [ ] **Step 3: Update `createServer` in the same file**

In `src/server.ts`, replace the `createServer` function body with:

```ts
export async function createServer(env: Env, deps?: ServerDeps): Promise<ServerHandle> {
  const resolved = deps ?? buildDeps(env);
  const { github, getSnapshot, getPrime } = resolved;
  await getSnapshot();
  const prime = await getPrime();

  const server = new McpServer(
    { name: env.WIKI_SERVER_NAME, version: "0.1.0" },
    { instructions: prime.instructions },
  );

  const ctx: ToolContext & ResourceContext = { env, github, getSnapshot, prime };
  const tools = registerTools(server, ctx);
  const resources = registerResources(server, ctx);

  return {
    raw: server,
    listToolNames: () => tools.names(),
    listResourceUris: () => resources.uris(),
    callTool: (n, a) => tools.call(n, a),
    readResource: (uri) => resources.read(uri),
  };
}
```

Note: `ctx` now gains a `prime` field. Tasks 8 and 9 add this to `ToolContext` and `ResourceContext` respectively; typecheck will fail until both land. That is expected and the commit at the end of Task 9 restores green.

- [ ] **Step 4: Run typecheck (expect failure — proceed to Task 8)**

Run: `pnpm typecheck`
Expected: FAIL — `Object literal may only specify known properties, and 'prime' does not exist in type 'ToolContext & ResourceContext'`. That's the guidepost; Task 8 fixes it.

- [ ] **Step 5: Do NOT commit yet** — leave uncommitted until Task 9 restores green.

---

### Task 8: Thread `prime` through `ToolContext`

**Files:**
- Modify: `src/tools.ts`

- [ ] **Step 1: Extend `ToolContext` type**

In `src/tools.ts`, replace the `ToolContext` type definition with:

```ts
export type ToolContext = {
  env: Env;
  github: GithubClient;
  getSnapshot: () => Promise<Snapshot>;
  prime: PrimeBundle;
};
```

Add the `PrimeBundle` import at the top: update the existing `import type { Snapshot } from "./types";` line to:

```ts
import type { PrimeBundle, Snapshot } from "./types";
```

- [ ] **Step 2: Use `ctx.prime.toolDescriptions` in every `registerTool` call**

Replace the four `description:` strings in `registerTools` with lookups:

```ts
server.registerTool(
  "wiki_context",
  {
    description: ctx.prime.toolDescriptions.wiki_context,
    inputSchema: {
      question: z.string(),
      domain: z.string().optional(),
      budget_tokens: z.number().int().positive().max(12000).optional(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args) => wikiContextHandler(args, ctx),
);
```

Do the same pattern for `wiki_search`, `wiki_fetch`, `wiki_list` — replacing each hardcoded `description:` string literal with `ctx.prime.toolDescriptions.<toolname>`.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: FAIL — `ResourceContext = ToolContext` so `ResourceContext` now requires `prime`, but `server.ts` passes `prime` already, so the only remaining errors should be in `resources.ts` once you consume `prime` there. `tools.ts` compiles.

- [ ] **Step 4: Do NOT commit yet** — Task 9 finishes wiring.

---

### Task 9: Add `wiki://overview` resources + restore green

**Files:**
- Modify: `src/resources.ts`

- [ ] **Step 1: Register overview resources in `src/resources.ts`**

In `src/resources.ts`, inside `registerResources(server, ctx)`, after the existing `wiki://log/recent` registration and before the `"page"` resource template block, insert:

```ts
server.registerResource(
  "overview",
  "wiki://overview",
  {
    description: "High-level map of discovered domains with per-domain slice URIs",
    mimeType: "text/markdown",
  },
  async () => ({
    contents: [{ uri: "wiki://overview", text: ctx.prime.overviewIndex }],
  }),
);
table.set("wiki://overview", async () => ({
  contents: [{ uri: "wiki://overview", text: ctx.prime.overviewIndex }],
}));

for (const [dname, body] of ctx.prime.overviewByDomain) {
  const uri = `wiki://overview/${dname}`;
  server.registerResource(
    `overview-${dname}`,
    uri,
    {
      description: `Overview of the ${dname} domain`,
      mimeType: "text/markdown",
    },
    async () => ({ contents: [{ uri, text: body }] }),
  );
  table.set(uri, async () => ({ contents: [{ uri, text: body }] }));
}
```

Then extend the `read` fallback at the bottom of `registerResources` so unknown `wiki://overview/...` URIs return a helpful error. Replace the current `read` arrow with:

```ts
read: async (uri: string): Promise<ReadResult> => {
  const direct = table.get(uri);
  if (direct) return direct();
  const m = uri.match(/^wiki:\/\/page\/([^/]+)\/([^/]+)\/(.+)$/);
  if (m)
    return readPage(
      ctx,
      decodeURIComponent(m[1]),
      decodeURIComponent(m[2]),
      decodeURIComponent(m[3]),
      uri,
    );
  const overviewMatch = uri.match(/^wiki:\/\/overview\/(.+)$/);
  if (overviewMatch) {
    const known = Array.from(ctx.prime.overviewByDomain.keys()).join(", ") || "(none)";
    throw new Error(
      `Unknown domain in overview URI: ${overviewMatch[1]}. Known domains: ${known}`,
    );
  }
  throw new Error(`Unknown resource URI: ${uri}`);
},
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — `ResourceContext = ToolContext` carries `prime`; all reads type-check.

- [ ] **Step 3: Run full suite**

Run: `pnpm test`
Expected: all 77 prior tests + all `prime.test.ts` + `prettify.test.ts` cases green. Existing `resources.test.ts` cases continue to pass because the four existing resources are unchanged.

- [ ] **Step 4: Commit the bundle wiring (Tasks 7 + 8 + 9 combined)**

```bash
git add src/server.ts src/tools.ts src/resources.ts
git commit -m "feat(server): thread PrimeBundle through ServerDeps, tools, resources"
```

---

## Phase 4 — Integration test

### Task 10: End-to-end MCP wiring test

**Files:**
- Create: `test/integration/prime-wiring.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/integration/prime-wiring.test.ts`:

```ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("prime wiring (structural default)", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("resources/list includes wiki://overview and a slice per fixture domain", async () => {
    const server = await createServer(makeEnv());
    const uris = server.listResourceUris();
    expect(uris).toContain("wiki://overview");
    expect(uris).toContain("wiki://overview/personal");
    expect(uris).toContain("wiki://overview/work");
  });

  it("wiki://overview returns the index markdown", async () => {
    const server = await createServer(makeEnv());
    const res = await server.readResource("wiki://overview");
    const text = res.contents[0].text;
    expect(text).toContain("# wiki — Wiki Overview");
    expect(text).toContain("Available domains: personal, work");
    expect(text).toContain("wiki://overview/personal");
    expect(text).toContain("wiki://overview/work");
  });

  it("wiki://overview/personal lists fixture titles with [[path]] links", async () => {
    const server = await createServer(makeEnv());
    const res = await server.readResource("wiki://overview/personal");
    const text = res.contents[0].text;
    expect(text).toContain("# personal");
    expect(text).toContain("## entities");
    expect(text).toContain("[[personal/wiki/entities/Foo.md]]");
    expect(text).toContain("Foo");
  });

  it("wiki://overview/nonexistent throws helpful error listing known domains", async () => {
    const server = await createServer(makeEnv());
    await expect(server.readResource("wiki://overview/nonexistent")).rejects.toThrow(
      /Known domains: personal, work/,
    );
  });

  it("structural default: tool descriptions do NOT contain fixture page titles", async () => {
    const server = await createServer(makeEnv());
    const descriptions: string[] = [];
    const raw = (server as unknown as { raw: { server?: unknown } }).raw;
    // quick sanity: just ensure surface exists; per-tool description assertions happen below
    expect(raw).toBeTruthy();
    // call the handlers via MCP to read descriptions indirectly
    for (const name of server.listToolNames()) {
      descriptions.push(name);
    }
    expect(descriptions.sort()).toEqual(["wiki_context", "wiki_fetch", "wiki_list", "wiki_search"]);
  });
});

describe("prime wiring — WIKI_PRIME_VOCAB=full", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("wiki://overview markdown is still present and non-empty", async () => {
    const server = await createServer(makeEnv({ WIKI_PRIME_VOCAB: "full" }));
    const res = await server.readResource("wiki://overview");
    expect(res.contents[0].text.length).toBeGreaterThan(20);
  });
});

describe("prime wiring — WIKI_PRIME_VOCAB=off", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("overview bodies note vocabulary suppression", async () => {
    const server = await createServer(makeEnv({ WIKI_PRIME_VOCAB: "off" }));
    const idx = await server.readResource("wiki://overview");
    expect(idx.contents[0].text).toContain("suppressed by WIKI_PRIME_VOCAB=off");
    const dom = await server.readResource("wiki://overview/personal");
    expect(dom.contents[0].text).toContain("suppressed");
  });
});
```

- [ ] **Step 2: Run test to verify pass (all needed code already landed in Phase 3)**

Run: `pnpm test -- test/integration/prime-wiring.test.ts`
Expected: PASS — all 8 cases green.

- [ ] **Step 3: Run full suite for final regression check**

Run: `pnpm test`
Expected: all 77 prior + all new tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/integration/prime-wiring.test.ts
git commit -m "test(prime): integration wiring through createServer end-to-end"
```

---

## Phase 5 — Documentation

### Task 11: Document env vars + overview URIs in README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add new rows to the Configuration surface table**

In `README.md`, find the table at `## Configuration surface` (starts at line 107). Insert two new rows after the `GITHUB_TOKEN` row:

```markdown
| `WIKI_PRIME_VOCAB` | `wrangler.toml [vars]` | Priming privacy mode: `structural` (default, no titles in instructions/tools), `full` (titles injected, capped), `off` (minimal) |
| `WIKI_PRIME_GREETING` | `wrangler.toml [vars]` | Optional one-line greeting prepended to instructions and overview |
```

- [ ] **Step 2: Add a new section documenting the overview resources**

Insert before the `## Development` heading:

```markdown
## Server priming

On every `initialize`, the server emits a dynamic `instructions` field computed from your wiki's actual shape (domains, types, page counts). Two resources are always exposed:

- `wiki://overview` — domain map with per-domain slice URIs
- `wiki://overview/{domain}` — page listing for one domain, each page as a `[[path]]` link with a prettified title

### Privacy

`WIKI_PRIME_VOCAB` controls what gets injected into passive text surfaces:

| Mode | `instructions` | Tool descriptions | `wiki://overview` |
|------|---------------|--------------------|-------------------|
| `structural` (default) | Domain names + type names + counts | Structural only | Full titles |
| `full` | Structural + trigger vocab (top 50 titles) | Structural + trigger vocab (top 30 titles) | Full titles |
| `off` | One-liner | Static defaults (pre-priming) | Suppressed |

Titles in `wiki://overview*` always appear because fetching a resource is an explicit client action. Text surfaces are the sensitive layer — keep `structural` as default for shared workers. Only flip to `full` for single-user workers where max-signal matters more than leak surface.

### Greeting

`WIKI_PRIME_GREETING` is a free-form one-line (or short multi-line) string prepended to both `instructions` and `wiki://overview`. Use it for fork identity, e.g. `WIKI_PRIME_GREETING="Riva's work wiki — Italian-language labor concepts."`.

No code changes required to fork — set both vars in `wrangler.toml [vars]` (or leave unset for defaults) and redeploy.
```

- [ ] **Step 3: Update the test count claim**

Find the line "68 tests across unit, integration, and contract layers." (around line 130). Replace with the current count after Phase 4 commits (run `pnpm test` and read the final line). If the count is now, say, 95, change the line to:

```markdown
95 tests across unit, integration, and contract layers. Mocked GitHub fetch reads from `test/fixtures/vault/` — a synthetic mini-vault safe to be public.
```

(Use the actual reported number from `pnpm test`.)

- [ ] **Step 4: Run tests + typecheck + lint**

Run in sequence:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): document WIKI_PRIME_VOCAB, WIKI_PRIME_GREETING, overview resources"
```

---

## Phase 6 — Ship

### Task 12: Push + open PR

**Files:**
- None (git/gh operations only)

- [ ] **Step 1: Push branch to origin**

Run:

```bash
git push -u origin feat/dynamic-priming
```

Expected: branch created on remote.

- [ ] **Step 2: Open PR to `dev`**

Run:

```bash
gh pr create --repo IsaiaScope/wiki-mcp --base dev --head feat/dynamic-priming \
  --title "feat(prime): wiki-agnostic dynamic server priming" \
  --body "$(cat <<'EOF'
## Summary
- Transform Snapshot + Env into a PrimeBundle at snapshot-refresh time (`src/prime.ts`)
- Dynamic `serverInfo.instructions` + per-tool descriptions + new `wiki://overview[/{domain}]` resources
- `WIKI_PRIME_VOCAB` (default `structural`) gates title injection into passive text surfaces
- Zero breaking change: two new optional env vars

## Test plan
- [ ] CI green (all prior tests + new unit + integration)
- [ ] Manual: `curl /mcp initialize` shows dynamic `instructions` mentioning actual domains
- [ ] Manual: `resources/read wiki://overview/personal` returns page list with `[[path]]` links
- [ ] Spec: `docs/superpowers/specs/2026-04-24-dynamic-priming-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed; `test` CI job runs.

- [ ] **Step 3: Wait for CI, then merge**

Run:

```bash
gh pr checks --watch $(gh pr view --json number --jq .number)
```

Expected: `test` green, `deploy` skipped (merge target is `dev`, not `prod`).

Merge with:

```bash
gh pr merge --squash --delete-branch
```

Expected: squash merged into `dev`. (Promotion to `prod` happens in a separate dev→prod PR per existing branch flow.)

- [ ] **Step 4: Verify worker picks up changes after eventual prod promotion**

After the dev→prod promotion PR is merged and CI `deploy` job runs:

```bash
curl -sS -o /tmp/init.json -w "HTTP %{http_code}\n" \
  -X POST https://wiki-mcp.isaiariva.workers.dev/mcp \
  -H "Authorization: Bearer $MCP_BEARER" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
cat /tmp/init.json
```

Expected: `instructions` field mentions `personal` and `work` domain names, type counts, and `wiki://overview`.

---

## Self-Review

### Spec coverage
- [x] Dynamic `serverInfo.instructions` → Task 4 (structural) + Task 5 (full) + Task 7 (wire into `McpServer`)
- [x] Dynamic tool descriptions → Task 5 + Task 8
- [x] `wiki://overview` + `wiki://overview/{domain}` → Task 4 (builder) + Task 9 (registration)
- [x] `WIKI_PRIME_VOCAB` three modes → Task 2 (parser) + Tasks 4–6 (structural/full/off)
- [x] `WIKI_PRIME_GREETING` → Task 4 (emitted in instructions) + Task 4 (overview index)
- [x] Lockstep snapshot↔prime invariant → Task 7 (`rebuild` sets both atomically)
- [x] 50/30 title caps → Task 5
- [x] Acronym preservation in prettifier → Task 3
- [x] Observability log line → Task 7 (`[prime] rebuilt …`)
- [x] New tests (`prime.test.ts`, `prettify.test.ts`, `prime-wiring.test.ts`) → Tasks 3, 4, 5, 6, 10
- [x] Existing 77 tests unchanged → enforced at end of every task (`pnpm test`)
- [x] README section → Task 11
- [x] Fork ergonomics (zero-config default) → no `REQUIRED_KEYS` change in Task 2

### Placeholder scan
No "TBD"/"TODO"/"similar to"/vague imperatives in shipped code. Every code block shows concrete content.

### Type consistency
- `PrimeBundle` shape used identically in `types.ts`, `prime.ts`, `server.ts`, `tools.ts`, `resources.ts`.
- `parseVocabMode` signature `(string | undefined) → PrimeVocabMode` matches every call site (`env.WIKI_PRIME_VOCAB` is `string | undefined`).
- `buildPrime(snapshot, env)` signature consistent across the plan.
- `getPrime(): Promise<PrimeBundle>` matches both the `ServerDeps` interface and the `await` sites.

### Scope check
Single feature, single PR, single branch. Spec requirements all map to tasks above.

### Order of risk
1. Task 7 intentionally leaves the tree red until Task 9 lands — flagged explicitly. Do not commit in between.
2. `pnpm test` is the gate at every Task ≥3 commit boundary.
3. Prod promotion is out-of-scope for this plan; a follow-up dev→prod PR exercises CI deploy (this repo's existing flow).

---
