<h3 align="center">upload ⬆️</h3>

<br />

<p align="center">
  <img src="https://img.shields.io/badge/cap-25_MB-EF4444" alt="25 MB cap" />
  <img src="https://img.shields.io/badge/scope-{domain}/raw/-7C3AED" alt="scope" />
  <img src="https://img.shields.io/badge/auth-contents:write-10B981" alt="contents:write" />
</p>

---

## 🔥 About

The single write path of `wiki-mcp`. Accepts arbitrary base64-encoded file content from an MCP client and commits it as-is into the backing GitHub repo at `{domain}/{RAW_FOLDER}/{subpath}`. No transformation, no compression, no extraction — bytes go to disk, downstream ingestion is somebody else's problem.

This module is intentionally tiny and pure. The MCP layer wraps it; the GitHub client carries it; everything in between is validation.

## 🗂️ Files

| | File | Responsibility |
|-|------|----------------|
| ⬆️ | `upload.ts` | `uploadFile(args, snapshot, github, env)` orchestrator + `sanitizeSubpath` + `checkSize` pure helpers |
| 📦 | `index.ts` | barrel export |

## 🔄 Flow

```
1. validate domain ∈ snapshot.domains          (else ERROR with valid list)
2. sanitizeSubpath(args.subpath)               (no traversal / null / >8 segments)
3. checkSize(args.content_base64, max)         (encoded ceiling + raw cap)
4. target = "{domain}/{RAW_FOLDER}/{subpath}"
5. github.fetchFileSha(target)                 (404 → create, 200 → update)
6. github.putFile(target, b64, message, sha?)
7. github.invalidate()                         (next read sees the new file)
8. return { ok: true, path, commit_sha, html_url }
```

## 🛡️ Sanitizer rules

`sanitizeSubpath` is the security boundary for the write path. It rejects:

| | Pattern | Why |
|-|---------|-----|
| 🚫 | `..` segment | directory traversal |
| 🚫 | leading `/` | absolute path injection |
| 🚫 | `\` anywhere | Windows-style traversal |
| 🚫 | `\0` | null-byte termination tricks |
| 🚫 | empty / trailing slash | not a file |
| 🚫 | > 8 segments | unreasonable nesting |
| 🚫 | segment > 255 chars | filesystem-unfriendly |

Repeated `/` are collapsed (cosmetic forgiveness). Surrounding whitespace is trimmed.

## 📏 Size cap

`checkSize` validates **twice**:

1. cheap pre-check on encoded length: `b64.length > ceil(MAX_UPLOAD_BYTES / 3) * 4` → reject before decoding
2. precise raw-byte count after padding: `floor(b64.length * 3 / 4) - padding > MAX_UPLOAD_BYTES` → reject

Default cap: **25 MB** (`MAX_UPLOAD_BYTES = 26214400`). Configurable in `wrangler.toml [vars]`.

## 🚀 No retries

If GitHub returns 409 (sha mismatch from a concurrent write), the error surfaces directly. Server-side retry would mask races that the client should resolve. Same for 5xx — surface, don't hide.

## 🧪 Testing

- `test/unit/upload.test.ts` — sanitizer + size-cap exhaustive cases, orchestrator unit coverage with stubbed `GithubClient`
- `test/integration/upload-github.test.ts` — end-to-end through real `GithubClient` with stubbed `fetch` (create / update / 401 / branch propagation)
- `test/contract/upload-contract.test.ts` — full MCP JSON-RPC client → worker → mocked GitHub
