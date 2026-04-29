# wiki-mcp Token-Performance Pass — Design

**Date:** 2026-04-29
**Status:** Draft (pending user review)
**Version impact:** breaking — `0.16.x` → `1.0.0`

## Goals

Reduce tokens consumed by caller LLMs per `wiki-mcp` interaction without losing retrieval signal. Targets:

- `wiki_context` (hot path): ~40-60% reduction.
- Tabular tools (`wiki_search`, `wiki_list`, `wiki_fetch`): ~20-30% reduction.
- Prime/instructions/tool descriptions: lower overhead on large vaults.

## Non-Goals

- Runtime/CPU performance on Cloudflare Workers (already adequate).
- Snapshot or fetch cache changes.
- Search ranking algorithm changes.
- New tool surfaces.

## Accuracy Guardrails

Token savings must not degrade question-answerability. The following are preserved:

- `wiki_search` snippet length (160 chars).
- `score` values in search rows (rounded to 2 decimal places, not removed).
- `truncated` flag on hits — caller knows when full body fetch is needed.
- Title and path are emitted separately from body.
- Hit bodies retain headings (Markdown structure is signal-rich).
- Tool descriptions retain semantic when-to-use guidance.
- `expand_links: true` flag preserves graph traversal when caller requests it.
- A regression test asserts the top-N retrieval results for fixed `(question, expected_path)` pairs are unchanged after refactor.

## Output Format Strategy — Hybrid

- **`wiki_context`**: Markdown text (no JSON envelope). Prose-heavy, benefits from natural-language emission.
- **`wiki_search` / `wiki_list` / `wiki_fetch`**: terse JSON with short keys. Tabular shape callers may parse.
- **`wiki_upload` / `wiki_read_raw`**: unchanged. Already lean.

## Per-Tool Changes

### `wiki_context`

**Input schema:**

```ts
{
  question: string,
  domain?: string,         // default "all"
  budget_tokens?: number,  // default 6000, max 12000
  expand_links?: boolean,  // NEW; default false (was implicit always-on one-hop)
}
```

Removed input field: `include_log` (log no longer in this tool — caller fetches `wiki://log/recent` resource on demand).

**Output:** plain Markdown text. Single `content[0].text` block.

```
# wiki_context

[hit] path/to/page.md  score=0.83  truncated=false
## Page Title
<body without YAML frontmatter; headings preserved; redacted per env>

[hit] another/path.md  score=0.71  truncated=true
...

[cite] Use [[path]] to cite. Quote Italian phrases verbatim with English gloss in brackets on first mention.
```

Removed from output:

- `schema` (use `wiki://schema` resource).
- `indexes` (use `wiki://index/all` resource).
- `recent_log` (use `wiki://log/recent` resource).
- `links_expanded` array per hit. When `expand_links: true`, expanded pages are emitted inline as additional `[hit] ...` blocks tagged with `via=<parent.md>` on the header line.
- `citation_instructions` JSON field (collapsed into the trailing `[cite]` Markdown line, emitted as a constant string by the renderer).
- JSON envelope (replaced by Markdown).

YAML frontmatter is stripped from each hit body before emission. The `[cite]` trailing line is always emitted, regardless of hit count.

### `wiki_search`

**Output shape:** terse JSON, short keys.

```json
[
  {"p": "a/b.md", "t": "Title", "sn": "first paragraph…", "s": 0.83}
]
```

| Old key   | New key | Note               |
| --------- | ------- | ------------------ |
| `path`    | `p`     |                    |
| `title`   | `t`     |                    |
| `snippet` | `sn`    | unchanged length   |
| `score`   | `s`     | rounded to 2 dp    |

Empty `sn` is omitted entirely.

### `wiki_list`

**Output shape:** grouped by domain → type, terse keys.

```json
{
  "g": {
    "personal": {
      "concepts": [{"p": "personal/wiki/concepts/foo.md", "t": "Foo"}],
      "entities": [{"p": "personal/wiki/entities/bar.md", "t": "Bar"}]
    }
  },
  "tot": 36,
  "off": 0,
  "lim": 200,
  "tr": false
}
```

| Old key     | New key |
| ----------- | ------- |
| `items`     | `g` (grouped) |
| `total`     | `tot`   |
| `offset`    | `off`   |
| `limit`     | `lim`   |
| `truncated` | `tr`    |

Pagination still applies after grouping is built (deterministic ordering: domains and types sorted by snapshot iteration order; rows within a type by path).

### `wiki_fetch`

**Output shape:** terse JSON; frontmatter object preserved (callers explicitly want it).

```json
[
  {"p": "a/b.md", "c": "<full markdown>", "fm": {"title": "..."}},
  {"p": "x", "err": "path not in snapshot"}
]
```

| Old key       | New key |
| ------------- | ------- |
| `path`        | `p`     |
| `content`     | `c`     |
| `frontmatter` | `fm`    |
| `error`       | `err`   |

### Prime / Instructions / Tool Descriptions

- Default `WIKI_PRIME_VOCAB`: `full` → `structural` (counts only, no titles).
- Trigger vocabulary removed from the `wiki_context` tool description — kept only in `instructions` (when mode is `full`).
- Per-domain overview lines change from `- [[path]] — Pretty Title` to `- path`.
- Instructions trigger-vocab cap: 50 → 20 titles.

### Unchanged

- `wiki_upload` — small request/response surface.
- `wiki_read_raw` — base64 binary, by design heavy.
- MCP resources (`wiki://schema`, `wiki://index/all`, `wiki://log/recent`, `wiki://overview*`, `wiki://page/...`) — already authoritative source for static content.

## Files Touched

| File | Change |
| ---- | ------ |
| `src/mcp/tools.ts` | Rewrite handler return-text formatting; new `expand_links` schema field; remove `include_log` from `wiki_context` schema. |
| `src/mcp/serialize.ts` | NEW. Centralized renderers: `renderContextMarkdown`, `renderSearchJSON`, `renderListJSON`, `renderFetchJSON`. |
| `src/search/context.ts` | `buildContext` returns trimmed `Bundle` (no schema/indexes/log); expansions conditional on `expand_links`; strip frontmatter from hit body before emission. |
| `src/types.ts` | New `Bundle` shape (drops `schema`, `indexes`, `recent_log`, `citation_instructions`); new tabular row types `SearchRow`, `ListRow`, `FetchRow`, `ListGrouped`; `Hit` retains `path`/`score`/`body`/`truncated`, drops `reason` and `links_expanded`. Expansions are represented as additional `Hit` entries with a new optional `viaParent?: string` field. |
| `src/wiki/frontmatter.ts` | Export `stripFrontmatterBlock(body)` — delimiter-only strip, no parse, used in hit body emission. |
| `src/prime/prime.ts` | Default vocab mode `structural`; drop trigger vocab from `wiki_context` tool description; instructions cap 50 → 20; per-domain overview line format change. |
| `src/env.ts` | `parseVocabMode` default → `structural`. |
| `src/mcp/resources.ts` | Unchanged. |
| `package.json` | `version` → `1.0.0`. |
| `README.md` | Document new shapes; add breaking change notice. |
| `tests/**` | Update fixtures for new shapes; add answerability and token-budget regression tests. |

## Data Flow

Internal pipeline (candidate paths → meta-rank → body fetch → body-rank → top-K → optional expansions) is unchanged. Only the emission step differs.

```
buildContext(input)
  → Bundle { hits, expansions, citation_instructions }
  → renderContextMarkdown(bundle, opts)
  → string
  → ToolResult.content[0].text

wiki_search → handler builds rows → renderSearchJSON(rows) → string
wiki_list   → handler builds grouped + page meta → renderListJSON(grouped, meta) → string
wiki_fetch  → handler builds rows → renderFetchJSON(rows) → string
```

## Error Handling

- `wiki_fetch` keeps per-row partial-failure surface (`err` field replaces `error`). Whole-batch failures still go through `errorResult`.
- `wiki_context` errors: existing `errorResult` shape (`ERROR: <msg>` text + `isError: true`). No format change.
- `stripFrontmatterBlock` is failure-safe: if leading `---` delimiter pair is missing or malformed, returns the body verbatim. Never throws.
- `expand_links: true` with budget exhaustion: existing budget loop in `buildContext` already truncates; no behavior change for that path.

## Testing

### Unit

- Each renderer in `src/mcp/serialize.ts` against fixed input → snapshot/string-equality test.
- `stripFrontmatterBlock`: cases — delimiter present, missing, malformed (only opening delimiter), empty body, body containing `---` mid-content (must not strip).

### Integration

- Update existing handler tests for new output strings/shapes.

### Regression — answerability

- New file `tests/answerability.test.ts`.
- Fixed list of `(question, domain, expected_top_paths)` pairs (≥6 pairs covering each domain).
- Assert the top-3 paths returned by `wiki_context` for each pair match a hard-coded expected set (order-insensitive). Run against committed corpus fixtures, not live snapshot. Failing this test blocks the merge.

### Regression — token budget

- New file `tests/token-budget.test.ts`.
- Representative `wiki_context` call against fixture corpus.
- Assert emitted token estimate (using existing `estimateTokens`) is at least 35% lower than a captured baseline. Baseline is committed as a fixture string for reproducibility.

### Backward-compat smoke

- None. `1.0.0` is an intentional break. Migration notes go in `README.md` and the `1.0.0` release note.

## Open Risks

- **Caller LLM adapts to short keys?** Tool descriptions document the new keys. Risk: a caller LLM sees terse JSON and asks the user to interpret. Mitigation: tool description includes a one-line legend (`p=path, t=title, sn=snippet, s=score`).
- **Resources discoverability.** Removing schema/indexes/log from `wiki_context` assumes callers can list/read MCP resources. All major MCP clients support this. Worst case: the caller LLM doesn't try resources for ambient context. Mitigation: `wiki_context` Markdown output ends with a one-line pointer (`[ctx] schema/indexes/log available at wiki://schema, wiki://index/all, wiki://log/recent`).
- **Vocab default change.** Existing deployments relying on default `full` lose trigger fanout silently on upgrade. Mitigation: `1.0.0` release note flags the default change; users restore via `WIKI_PRIME_VOCAB=full`.
