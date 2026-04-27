# Design: wiki_upload — generic file upload to wiki repo via MCP

**Status:** Approved
**Date:** 2026-04-24
**Author:** Riva Isaia

## Goal

Extend the `wiki-mcp` server with a write path that lets an MCP client upload any file (PDF, image, text, arbitrary binary) into the backing GitHub wiki repo, stored under `{domain}/raw/{subpath}`. File bytes are committed as-is — no transformation, no compression. Follow-up ingestion of uploaded files happens in a separate agent workflow, outside this server.

## Non-goals

- Server-side size reduction (no PDF compression, no image re-encoding).
- Server-side content extraction (no PDF→text, no OCR).
- Read-back tool for uploaded binaries (agent can open GitHub directly if needed).
- Text page authoring flow (`wiki_write_page` or similar) — out of scope for this spec.
- Asset storage outside GitHub (no R2, no KV).

## Architecture

```
Claude client
     │  JSON-RPC over Streamable HTTP (same /mcp endpoint)
     ▼
Cloudflare Worker (wiki-mcp)
  ├─ read path (tools + resources) — unchanged
  └─ write path: wiki_upload(domain, subpath, content_base64, message?)
        validate domain ∈ snapshot.domains
        sanitize subpath (no traversal, bounded segments)
        enforce size cap (MAX_UPLOAD_BYTES, default 25 MB)
        PUT /repos/{o}/{r}/contents/{domain}/{RAW_FOLDER}/{subpath}
          - 404 on pre-GET → create (no sha)
          - 200 on pre-GET → update (include sha)
        invalidate snapshot cache
        return { ok, path, commit_sha, html_url }
```

Auth:
- Client → worker: existing `MCP_BEARER` (unchanged).
- Worker → GitHub: existing `GITHUB_TOKEN` secret; PAT scope upgraded from `contents:read` to `contents:write`.

State model: stateless worker, no new persistence. Reuses `GithubClient` + `Snapshot` for domain validation.

## Components

### New files

- **`src/upload.ts`** — pure orchestrator. Signature:
  ```typescript
  export async function uploadFile(
    args: UploadArgs,
    snapshot: Snapshot,
    github: GithubClient,
    env: Env,
  ): Promise<UploadResult>;
  ```
  Responsibilities: domain validation, subpath sanitization, size cap enforcement, default commit message, delegation to `github.putFile`. Returns `{ ok, path, commit_sha, html_url }` or throws typed error.

### Changed files

- **`src/github.ts`** — extend `GithubClient`:
  - `fetchFileSha(path: string): Promise<string | null>` — GET `/contents/{path}?ref={branch}`; return sha or `null` on 404.
  - `putFile(path: string, contentBase64: string, message: string, sha?: string): Promise<PutFileResult>` — PUT `/contents/{path}` with `{message, content, branch, sha?, committer}`.
- **`src/tools.ts`** — register 5th tool `wiki_upload`. Input schema:
  ```typescript
  {
    domain: z.string(),
    subpath: z.string(),
    content_base64: z.string(),
    message: z.string().optional(),
  }
  ```
  Tool description dynamically lists valid domains from the snapshot at `createServer` time (same injection pattern as the existing server `instructions` string).
- **`src/env.ts`** — add:
  - `MAX_UPLOAD_BYTES` var, default `"26214400"` (25 MB).
  - `RAW_FOLDER` var, default `"raw"`.
- **`wrangler.toml`** — add defaults for the two new vars.
- **`README.md`** — document `wiki_upload` tool, PAT scope upgrade to `contents:write`, new env vars.

### Tests

- **`test/unit/upload.test.ts`** — domain validation, subpath sanitization, size caps, path assembly, default commit message.
- **`test/integration/upload-github.test.ts`** — stub global `fetch`; exercise create vs update paths, error statuses, branch param, cache invalidation.
- **`test/contract/upload-contract.test.ts`** — in-process MCP client → worker → mocked GitHub; verify `tools/list` includes `wiki_upload`, `tools/call` success and error flows, dynamic domain list in tool description.
- **`test/fixtures/vault/personal/raw/.gitkeep`** — fixture placeholder so discover.ts correctly ignores `raw/` folders.

## Data flow

Input (tool arguments):

```typescript
{
  domain: string,          // must match a discovered domain
  subpath: string,         // path under {domain}/{RAW_FOLDER}/, e.g. "docs/2026/test.pdf"
  content_base64: string,  // raw file bytes, base64-encoded by client
  message?: string,        // optional commit message
}
```

Steps:

1. **Auth** — existing bearer middleware, unchanged.
2. **Parse** — zod schema validation. Reject empty `content_base64` or empty `subpath`.
3. **Domain check** — `snapshot.domains.has(domain)`. On miss: `ERROR: unknown domain 'X'. Valid: [a, b]`.
4. **Subpath sanitize**:
   - Reject `..`, leading `/`, absolute paths, null bytes, backslash.
   - Collapse repeated slashes. Trim surrounding whitespace.
   - Cap total segments at 8, per-segment length at 255 chars.
5. **Size cap** — reject early if `base64.length > ceil(MAX_UPLOAD_BYTES / 3) * 4` (catches oversized payloads before decode). Then compute `rawBytes = floor(base64.length * 3 / 4) - paddingCount` (padding = count of trailing `=`); reject if `rawBytes > MAX_UPLOAD_BYTES`.
6. **Target path** — `{domain}/{RAW_FOLDER}/{subpath}` (default `RAW_FOLDER = "raw"`).
7. **GitHub PUT**:
   - `github.fetchFileSha(target)` to detect create vs update.
   - `github.putFile(target, content_base64, message, sha?)`.
   - `committer` fixed to `wiki-mcp <wiki-mcp@users.noreply.github.com>` so commits are attributable.
   - `branch` from `env.GITHUB_BRANCH`.
8. **Snapshot invalidation** — `github.invalidate()` so the next read-side call refreshes the tree.
9. **Return** — `{ ok: true, path, commit_sha, html_url }` as the JSON payload inside the tool result's text content.

### Default commit message

`chore(raw): upload {subpath}` when `message` not provided.

## Errors + edge cases

All errors return an MCP `ToolResult` with `isError: true` and a single text content block shaped `ERROR: {message}`.

| Case | Message |
|------|---------|
| Invalid zod field | `ERROR: invalid input: {zod message}` |
| Unknown domain | `ERROR: unknown domain 'X'. Valid: [a, b]` |
| Subpath traversal | `ERROR: invalid subpath — traversal not allowed` |
| Empty content | `ERROR: content_base64 is empty` |
| Invalid base64 | `ERROR: content_base64 is not valid base64` |
| Size over cap | `ERROR: file too large: X MB > cap Y MB` |
| GitHub 401/403 | `ERROR: GitHub auth failed — check GITHUB_TOKEN has contents:write` |
| GitHub 409 (sha mismatch) | `ERROR: conflict — file changed. Retry.` |
| GitHub 422 (bad path) | `ERROR: GitHub rejected path: {msg}` |
| GitHub 5xx | `ERROR: GitHub upstream {status} — retry later` |

Edge cases:

- **Base64 size estimation** — check both raw byte count and encoded length to avoid oversized payloads slipping through one path.
- **Overwrite** — existing file → overwrite via sha; git history retains the old version. No `if_exists: "error"` flag in v1 (YAGNI).
- **Concurrent uploads same path** — GitHub 409 surfaces directly. No server-side retry (client decides).
- **Snapshot staleness** — invalidated on successful upload; next read-side call pays one tree fetch.
- **Raw folder auto-creation** — GitHub Contents PUT creates intermediate dirs automatically; no pre-check required.
- **Empty domain set** — if discover found no domains, tool description shows `Valid domains: []` and every call fails the domain check with a clear error.
- **Rate limits** — GitHub 5000 req/hr per PAT; worker is stateless, no server-side throttle in v1. Documented in README.

## Testing

Matches the existing test pyramid (unit → integration → contract). All existing tests must stay green.

- **Unit** (`test/unit/upload.test.ts`): pure logic, no fetch. Domain validation, subpath sanitization (traversal, absolute, null byte, backslash, empty segments, segment count/length caps), size caps (raw + base64), target path assembly, default commit message format.
- **Integration** (`test/integration/upload-github.test.ts`): stubs global `fetch`. Create path (GET 404 → PUT without sha), update path (GET 200 → PUT with sha), 401/403/409/422/5xx error surfaces, `branch` param propagation, snapshot cache invalidation after success.
- **Contract** (`test/contract/upload-contract.test.ts`): in-process MCP client → worker → mocked GitHub. `tools/list` includes `wiki_upload` with 5 total tools, successful `tools/call`, error `tools/call` (unknown domain), tool description contains the discovered domain list.
- **Fixtures**: add `test/fixtures/vault/personal/raw/.gitkeep` and verify existing discover.ts unit tests still pass (raw folder must be ignored by discovery).
- **Coverage target**: maintain existing branch coverage; `upload.ts` and new `GithubClient` methods ≥ 90%.

## Deployment + rollout

- Upgrade the `GITHUB_TOKEN` PAT scope from `Contents: Read-only` to `Contents: Read and write` before merging to prod.
- Update `wrangler.toml` with `MAX_UPLOAD_BYTES` and `RAW_FOLDER` defaults.
- README updated with: new tool signature, PAT scope change, new env vars, upload size cap.
- No new secrets required.
- Backward compatible: existing 4 tools + 4 resources unchanged.

## Open questions

None at spec time. All clarifying questions resolved during brainstorming.
