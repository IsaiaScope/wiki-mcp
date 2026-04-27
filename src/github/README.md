<h3 align="center">github 🐙</h3>

<br />

<p align="center">
  <img src="https://img.shields.io/badge/API-REST_v3-181717?logo=github&logoColor=white" alt="GitHub REST" />
  <img src="https://img.shields.io/badge/cache-SHA_pinned-2D3748" alt="SHA-pinned cache" />
  <img src="https://img.shields.io/badge/perms-contents:read+write-10B981" alt="contents:read+write" />
</p>

---

## 🔥 About

Thin client over the GitHub REST API and `raw.githubusercontent.com`. Owns every byte that crosses the worker → GitHub boundary: tree listings, raw page bodies, file SHAs, and content writes.

The client keeps a tiny in-memory **TTL cache** (default 60 s, `CACHE_TTL_SECONDS`) for the recursive tree fetch — every other request piggybacks on the cached SHA so raw bodies are pinned to that exact commit, which makes them edge-cacheable by Cloudflare for free.

## 🗂️ Files

| | File | Responsibility |
|-|------|----------------|
| 🔌 | `client.ts` | `GithubClient` — `fetchTree`, `fetchBody`, `fetchFileSha`, `putFile`, `invalidate`, `isStale` |
| 📦 | `index.ts` | barrel export |

## 🌐 Endpoints touched

| | Endpoint | Used by | Why |
|-|----------|---------|-----|
| 🌳 | `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` | `fetchTree` | one-shot directory listing for snapshot building |
| 📄 | `GET https://raw.githubusercontent.com/{o}/{r}/{sha}/{path}` | `fetchBody` | SHA-pinned raw content (edge cacheable) |
| 🔍 | `GET /repos/{o}/{r}/contents/{path}?ref={branch}` | `fetchFileSha` | pre-check for create vs update on `wiki_upload` |
| ✍️ | `PUT /repos/{o}/{r}/contents/{path}` | `putFile` | create or update a file in a single call (commits with `wiki-mcp` committer) |

## 🛡️ Error mapping

`putFile` translates GitHub status codes into hand-written messages so callers don't need to read GitHub docs to debug:

| Status | Surface message |
|--------|-----------------|
| 401/403 | `GitHub auth failed — check GITHUB_TOKEN has contents:write` |
| 409 | `GitHub conflict — file changed concurrently. Retry.` |
| 422 | `GitHub rejected path: {message}` |
| other ≥400 | `GitHub PUT failed ({status})` |

## 🧪 Testing

`test/unit/github.test.ts` stubs `globalThis.fetch` and exercises all four methods plus the cache + percent-encoding paths. End-to-end behavior with the orchestrator lives in `test/integration/upload-github.test.ts`.
