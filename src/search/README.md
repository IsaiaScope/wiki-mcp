<h3 align="center">search 🔍</h3>

<br />

<p align="center">
  <img src="https://img.shields.io/badge/ranking-BM25-D97757" alt="BM25" />
  <img src="https://img.shields.io/badge/budget-token_aware-10B981" alt="token-aware" />
  <img src="https://img.shields.io/badge/expansion-1_hop_links-7C3AED" alt="link expansion" />
</p>

---

## 🔥 About

The retrieval and bundling layer that powers `wiki_context` and `wiki_search`. Three small pieces working in concert:

1. **rank** — a BM25 scorer over path tokens with IT + EN stopwords and a phrase-substring bonus. Returns `{id, score}` pairs ordered by relevance.
2. **budget** — token estimator and heading-aware truncator so a bundle never overflows the agent's context window.
3. **context** — the orchestrator. Builds a full `Bundle` (schema + indexes + log tail + ranked hits + one-hop wikilink expansion) from a question, snapshot, and budget.

`wiki_context` calls `buildContext` once per request; the result is the entire knowledge package the agent reads before answering.

## 🗂️ Files

| | File | Responsibility |
|-|------|----------------|
| 📊 | `rank.ts` | `tokenize`, `rankDocs` — BM25 implementation with bilingual stopwords |
| ✂️ | `budget.ts` | `estimateTokens`, `truncateAtHeading` — char-based token approximation, heading-aware cuts |
| 🎁 | `context.ts` | `buildContext` — schema concat, top-k selection, link expansion, budget clamp |
| 📦 | `index.ts` | barrel export |

## 🧮 Bundle anatomy

`buildContext` returns this shape (consumed verbatim by the agent):

```ts
type Bundle = {
  schema: string;                    // concatenated CLAUDE.md + docs/llm-wiki.md + per-domain CLAUDE.md
  indexes: Record<string, string>;  // domain → index.md
  recent_log: string[];              // last 50 log entries across domains
  hits: Hit[];                       // ranked pages + bodies + 1-hop links
  citation_instructions: string;     // “Cite with [[path]]”
};
```

Each `Hit` is `{ path, score, reason, body, links_expanded[] }`. Bodies are budget-clamped — large pages are truncated at the nearest heading instead of mid-sentence.

## ⚖️ Budget rules

- Default `budget_tokens = 6000`. Hard ceiling 12000 (zod-enforced on the tool input).
- Schema and indexes get the first slice; remaining budget feeds hits in score order.
- A hit producing zero tokens after truncation is dropped (no useless empties).

## 🧪 Testing

- `test/unit/rank.test.ts` — tokenization, stopword filtering, scoring monotonicity
- `test/unit/budget.test.ts` — char-to-token estimate, heading-aware truncation
- `test/integration/context.test.ts` — full bundle build over the synthetic vault fixture
