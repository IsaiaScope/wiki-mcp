<h3 align="center">prime 🪄</h3>

<br />

<p align="center">
  <img src="https://img.shields.io/badge/instructions-dynamic-EF4444" alt="dynamic" />
  <img src="https://img.shields.io/badge/vocab-structural|full|off-7C3AED" alt="vocab modes" />
  <img src="https://img.shields.io/badge/scope-tool_descriptions_+_overview-10B981" alt="scope" />
</p>

---

## 🔥 About

Builds the `PrimeBundle` — the dynamic glue that makes the worker self-describing to any client. On every snapshot rebuild, prime regenerates:

- the **`instructions`** field returned on `initialize` (greeting + per-domain summary + optional trigger vocabulary)
- the **tool descriptions** advertised on `tools/list` (so the agent sees the actual valid domains for `wiki_upload`, etc.)
- two markdown **overview resources** (`wiki://overview` and `wiki://overview/{domain}`) — a typed inventory of every page

Without prime the agent gets static text that can drift from the real wiki. With prime, every passive surface reflects the current commit.

## 🗂️ Files

| | File | Responsibility |
|-|------|----------------|
| 🪄 | `prime.ts` | `buildPrime(snapshot, env)` + `prettifyTitle(raw)` (acronym-preserving casing) |
| 📦 | `index.ts` | barrel export |

## 🔒 Vocabulary privacy

`WIKI_PRIME_VOCAB` controls how much wiki content leaks into passive surfaces (those that are visible to the agent without an explicit tool call):

| Mode | What gets injected | Use when |
|------|---------------------|----------|
| `structural` (default) | per-domain page counts, type breakdown — no titles | balanced default; titles stay private |
| `full` | flat trigger list of up to 50/30 prettified titles | private deployment, want maximum agent priming |
| `off` | minimal greeting + bare instruction | shared deployment, suppress everything |

The active mode is also visible in the prime log line at startup:
```
[prime] rebuilt sha=abc123s domains=2 vocabMode=structural titles=4
```

## 🌐 Overview resources

| Resource | Content |
|----------|---------|
| `wiki://overview` | top-level index — domain list with per-domain slice URIs |
| `wiki://overview/{domain}` | per-domain page listing grouped by type, each `[[path]] — Pretty Title` |

These are what the agent reads to learn the wiki's shape *before* deciding which read tool to call.

## 🧪 Testing

- `test/unit/prime.test.ts` — instructions/tool-desc/overview generation across all three modes
- `test/unit/prettify.test.ts` — title casing, acronym preservation, ISO-date handling
- `test/integration/prime-wiring.test.ts` — end-to-end through `createServer`, including refresh propagation
