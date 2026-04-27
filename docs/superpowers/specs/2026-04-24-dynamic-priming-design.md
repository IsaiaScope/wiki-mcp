# Dynamic Server Priming — Design Spec

**Date:** 2026-04-24
**Status:** Approved for planning
**Branch:** `feat/dynamic-priming`

## Problem

`wiki-mcp` is meant to be a reusable MCP server — fork it, point it at your own wiki repo, connect it to Claude. The code already parameterizes the vocabulary of a wiki (`GITHUB_REPO`, `DOMAIN_REQUIRED_FILES`, `SCHEMA_GLOBS`), but the text Claude sees on connect is still hard-coded:

- `src/server.ts:57` — `serverInfo.instructions` is a fixed string.
- `src/tools.ts` — each tool description is hard-coded and generic.
- No "what's in this wiki" summary surface exists; Claude has to call `wiki_list` to find out.

Result: a fresh fork with different content gets a connector whose priming text doesn't reflect the user's actual wiki. Claude doesn't know which proper nouns should trigger `wiki_context`, which domains exist, or what the type taxonomy is until it makes a tool call.

## Goal

When a user forks and deploys with their own wiki, the server should introspect the tree and emit, at `initialize` time:

1. An `instructions` string listing **their** domains, types, and page counts.
2. Tool descriptions seeded with **their** trigger vocabulary (when explicitly opted in).
3. A `wiki://overview` resource with a compact "what's inside" summary, plus per-domain slices.

All three surfaces recompute in lockstep with the existing stale-while-revalidate snapshot — no new fetch path, no breaking change.

## Non-goals

- Reading page bodies at prime time (deferred; adds O(N) HTTP calls).
- MCP `prompts/list` capability (deferred to a follow-up spec).
- Per-user personalization beyond what `WIKI_PRIME_GREETING` allows.
- Renaming or reorganizing existing modules.

## Locked design decisions

| # | Choice | Rationale |
|---|---|---|
| 1 | **Surfaces**: instructions + tool descriptions + overview resource | Covers text-scraping clients and resource-aware clients. Defers prompts API. |
| 2 | **Vocab source**: basename + prettifier, no body fetch | Zero network cost, predictable, ships fast. Upgrade later if needed. |
| 3 | **Privacy**: tiered. Structural default, `full` opt-in, `off` escape hatch | Forks out-of-box don't leak titles into every transcript; resource-aware clients still get rich vocab. |
| 4 | **Overview layout**: `wiki://overview` index + `wiki://overview/{domain}` slices | Scales past large wikis without needing byte caps; clients that don't read resources aren't affected. |
| 5 | **Env surface**: 2 new optional vars (`WIKI_PRIME_VOCAB`, `WIKI_PRIME_GREETING`) | Zero-config default; one knob for privacy, one for identity. |
| 6 | **Code structure**: new `src/prime.ts` module | One testable seam between snapshot (data) and MCP binding (presentation). |

## Architecture

```
 GitHub tree
      |
      v
  src/discover.ts -> Snapshot --+
                                |
                                v
                        src/prime.ts
                                |
                 +--------------+--------------+
                 v              v              v
          instructions   toolDescriptions   overview*
                 |              |              |
                 v              v              v
         server.ts         tools.ts       resources.ts
                 |              |              |
                 +--------------+--------------+
                                v
               MCP wire: initialize, tools/list, resources/*
```

**Lifecycle.** `buildPrime(snapshot, env)` runs once per snapshot refresh. Cached as `deps.prime` alongside `deps.snapshot`. When `refresh()` rebuilds snapshot, it rebuilds prime in the same critical section, so snapshot and prime always share a SHA.

**Privacy.** `env.WIKI_PRIME_VOCAB` controls what goes where:
- `structural` (default): domain names + type names + counts in instructions and tool descriptions. Page titles only in `wiki://overview*` resources (which a client must fetch explicitly).
- `full`: page titles also injected into instructions and tool descriptions (max signal, max leak).
- `off`: minimal instructions, static tool descriptions, overview resources still listed but bodies say vocabulary is suppressed.

**Fork ergonomics.** Zero breaking change. Optional env vars, sensible defaults. Forks that set neither get structural priming automatically — better than today's hard-coded string without any config work.

## Components

### `src/types.ts` — new exports

```ts
export type PrimeVocabMode = "structural" | "full" | "off";
export type ToolName = "wiki_context" | "wiki_search" | "wiki_fetch" | "wiki_list";
export type PrimeBundle = {
  instructions: string;                       // injected at initialize
  toolDescriptions: Record<ToolName, string>; // per-tool override
  overviewIndex: string;                      // served at wiki://overview
  overviewByDomain: Map<string, string>;      // served at wiki://overview/{domain}
  vocabMode: PrimeVocabMode;                  // echoed for debug
  sha: string;                                // snapshot sha this was built from
};
```

### `src/prime.ts` — new module

Pure, synchronous, no I/O:

```ts
export function buildPrime(snapshot: Snapshot, env: Env): PrimeBundle
```

Internals:

- `prettifyTitle(basename)` — split on `-`/`_`/whitespace, title-case each word, preserve known acronyms (`CCNL`, `TFR`, `ID`, `URL`, `API`, `MCP` as a starting allowlist). Zero network.
- `collectVocab(snapshot)` — `Map<domainName, Map<typeName, string[]>>` with prettified titles as leaves.
- `buildInstructions(snapshot, vocab, env)` — always includes server name, greeting (if set), domain names, type names, page counts. Under `vocabMode=full`, appends a flat trigger list capped at **50 titles**, alphabetical, cross-domain. Under `vocabMode=off`, returns a minimal one-liner.
- `buildToolDescriptions(vocab, vocabMode)` — dynamic descriptions for each tool. Always mentions `wiki://overview` in `wiki_context`. Under `vocabMode=full`, appends a trigger list capped at **30 titles**. Under `vocabMode=off`, returns the original static strings.
- `buildOverviewIndex(snapshot, env)` — markdown listing domains with page counts and slice URIs.
- `buildOverviewByDomain(snapshot, env)` — `Map<domain, markdown>` with every page as a `[[path]]` link and prettified title.

Caps are constants in `prime.ts` (JSDoc'd), not env vars. YAGNI: no evidence anyone needs to tune them.

### `src/env.ts` — additive

- Extend `Env` type: `WIKI_PRIME_VOCAB?: string`, `WIKI_PRIME_GREETING?: string`. Not added to `REQUIRED_KEYS` — optional.
- New helper `parseVocabMode(raw?: string): PrimeVocabMode`. Unknown values fall back to `"structural"` silently (don't throw on typo).

### `src/server.ts` — consume prime

- `ServerDeps` gains `getPrime(): Promise<PrimeBundle>`.
- `buildDeps` caches `prime` alongside `snapshot`. `refresh()` rebuilds both.
- `createServer` awaits `getPrime()`, passes `prime.instructions` to `McpServer`, passes `prime` into `registerTools` and `registerResources`.

### `src/tools.ts` — consume descriptions

- `ToolContext` gains `prime: PrimeBundle`.
- Each `server.registerTool` call uses `prime.toolDescriptions[name]` instead of a hardcoded string.

### `src/resources.ts` — serve overview

- Two new resources:
  - `wiki://overview` -> `prime.overviewIndex`
  - `wiki://overview/{domain}` -> `prime.overviewByDomain.get(domain)` or `resources/read` error on unknown domain.
- Existing `wiki://index/*` resources untouched.
- At `resources/list` time, enumerate one concrete `wiki://overview/{domain}` entry per discovered domain (so clients without URI-template support still see them).

## Data flow

### Cold start (first request after worker boot)

1. `POST /mcp {initialize}`
2. `getDeps(env)` — `assertEnv`, construct `GithubClient`, `snapshot = null`, `prime = null`.
3. `createServer(env, deps)`:
   - `await deps.getSnapshot()` (blocking first fetch; caches snapshot).
   - `await deps.getPrime()` (pure; caches prime).
4. `new McpServer({ name, version, instructions: prime.instructions })`.
5. `registerTools(server, { env, github, getSnapshot, prime })` — dynamic descriptions.
6. `registerResources(server, { env, github, getSnapshot, prime })` — overview wired.
7. Transport handles the `initialize` request; response carries `prime.instructions`.

### Stale-while-revalidate refresh

1. Request arrives; `deps.isStale()` true.
2. `ctx.waitUntil(deps.refresh())`:
   - `github.invalidate()`; `fetchTree()`; `buildSnapshot()`; `buildPrime()`; atomic swap of both into module-scope cache.
3. In-flight request still sees the old snapshot+prime (SWR semantics preserved).
4. Next request sees the new snapshot+prime.

**Invariant:** `snapshot.sha === prime.sha` always. Partial rebuilds cannot happen because `refresh()` is the only writer.

### Resource read

- `resources/read wiki://overview` -> return `prime.overviewIndex`.
- `resources/read wiki://overview/{domain}` -> `prime.overviewByDomain.get(domain)` or MCP `resources/read` error with a message listing available domains.

## Error handling

`buildPrime` is pure and synchronous. Failure modes are programmer errors; fail loud instead of silent fallbacks. Explicit cases:

| Case | Behavior |
|---|---|
| Zero domains discovered | Instructions explain the discovery contract; no crash. |
| Domain with zero pages | Included in overview with `(empty)` marker; excluded from trigger vocab under `full`. |
| `WIKI_PRIME_VOCAB` unknown value | `parseVocabMode` falls back to `structural` silently. |
| `WIKI_PRIME_GREETING` with markdown or unicode | Passed through verbatim (trimmed). UTF-8 over JSON-RPC is fine. |
| `vocabMode=off` | One-liner instructions, static tool descriptions, overview bodies note suppression. |
| Unknown domain in `wiki://overview/{domain}` | MCP `resources/read` error listing available domains. |
| `vocabMode=full` on 1000+ titles | Flat trigger list capped (50 in instructions, 30 in tool descriptions). Overview resources not capped. |
| Title collisions across domains | Both kept in overview (qualified by `[[domain/path]]`); trigger vocab dedupes. |
| `buildPrime` throws | Propagates to request handler as 500; surfaces in `wrangler tail`. Preferred over silent fallback. |
| Snapshot refresh fails mid-flight | Existing SWR behavior: error swallowed, stale prime stays, next request retries. |

Observability: one `console.log` at each successful rebuild: `[prime] rebuilt for sha={sha7}, domains={n}, vocabMode={mode}, titles={count}`. Skipped when `vocabMode=off`.

## Testing

All Vitest, no new tooling.

### `test/unit/prime.test.ts`

Pure-function tests against hand-built `Snapshot` fixtures.

- Empty snapshot -> valid bundle with "no domains" instructions.
- Single domain -> instructions list domain + types + counts.
- `vocabMode=structural` -> instructions contain no page titles.
- `vocabMode=full` -> flat trigger list present, capped at 50 titles.
- `vocabMode=off` -> minimal one-liner instructions, static tool descriptions.
- Unknown `vocabMode` -> falls back to structural, no throw.
- Greeting prepended when set, absent when empty.
- Overview index markdown structure matches snapshot.
- Per-domain overview markdown lists all pages with `[[path]]` links.
- Title collision across domains preserved in overview.
- Unicode titles (TFR, CCNL Metalmeccanico) passthrough.

### `test/unit/prettify.test.ts`

Table-driven:
- `ccnl-metalmeccanico` -> `CCNL Metalmeccanico`
- `A.Agrati SPA` -> `A.Agrati SPA` (preserve)
- `2026-04-24-fincons-busta-paga-2023` -> `2026-04-24 Fincons Busta Paga 2023`
- `tfr` -> `TFR`
- `llm-wiki-pattern` -> `LLM Wiki Pattern`

### `test/integration/prime-wiring.test.ts`

Full `createServer` against the fixture vault snapshot.

- `initialize` response carries dynamic `instructions` containing fixture domain names.
- `tools/list` returns descriptions from `prime.toolDescriptions`.
- `resources/list` includes `wiki://overview` + one `wiki://overview/{domain}` per fixture domain.
- `resources/read wiki://overview` returns the index markdown.
- `resources/read wiki://overview/personal` returns per-domain markdown with fixture titles.
- `resources/read wiki://overview/nonexistent` returns MCP error.
- After a simulated `refresh()` with a new snapshot, the next `resources/read` reflects the update.
- `WIKI_PRIME_VOCAB=off` -> minimal instructions, existing tests still pass.

### `test/unit/env.test.ts` — additions

- `parseVocabMode` returns `structural` for unknown input.
- Optional `WIKI_PRIME_*` vars absent -> `assertEnv` still passes.

### Regression

- Existing 77 tests must still pass. Prime layer is additive.

### Invariants the tests prove

1. **Privacy:** under `vocabMode=structural`, no page title string appears in `instructions` or any `tools/list` description.
2. **Lockstep:** `snapshot.sha === prime.sha` after every `refresh()`.
3. **Determinism:** `buildPrime(snap, env)` is byte-identical across repeated calls with the same inputs.

## Fork ergonomics checklist

For a fork to light up with dynamic priming, the user needs:

- [x] `wrangler.toml [vars]` — already present: `GITHUB_REPO`, `GITHUB_BRANCH`, `WIKI_SERVER_NAME`, `DOMAIN_REQUIRED_FILES`, `SCHEMA_GLOBS`.
- [ ] Optional: `WIKI_PRIME_VOCAB=structural|full|off` (default `structural`).
- [ ] Optional: `WIKI_PRIME_GREETING="..."` (default empty).

No other config changes. Zero-config fork gets structural priming automatically.

## Security notes

- `WIKI_PRIME_VOCAB=full` injects page titles into every MCP client transcript. For workers shared across users, keep `structural` default. Document this in `README.md`.
- `WIKI_PRIME_GREETING` is user-controlled text emitted to every transcript. No secrets should be placed there; it renders as plain markdown.
- Overview resources reveal page paths (not contents). A client with bearer access can already list these via `wiki_list`; overview is not a privilege escalation.

## Rollout

Single PR against `dev` containing:
- `src/prime.ts` + `src/types.ts` changes.
- `src/env.ts` additions (no assertEnv breakage).
- `src/server.ts` + `src/tools.ts` + `src/resources.ts` wiring.
- New tests (`test/unit/prime.test.ts`, `test/unit/prettify.test.ts`, `test/integration/prime-wiring.test.ts`).
- README section documenting the two new env vars, the three vocab modes, the overview resource URIs, and the privacy trade-off.
- No wrangler.toml defaults (optional vars, left unset).

After merge to `dev`, next promotion to `prod` triggers CI auto-deploy. Restart Claude Code to pick up the new `instructions` field; existing clients continue to work without changes.
