# wiki_upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th MCP tool `wiki_upload` that accepts any file (PDF, image, text, arbitrary binary) and commits it as-is to `{domain}/raw/{subpath}` in the backing GitHub wiki repo.

**Architecture:** New pure `src/upload.ts` orchestrator validates the domain, sanitizes the subpath, enforces a size cap, then delegates to extended `GithubClient` methods (`fetchFileSha` + `putFile`) that call the GitHub Contents REST API. Stateless worker, no new persistence; existing snapshot cache is invalidated after each successful write.

**Tech Stack:** TypeScript, Cloudflare Workers runtime, `@modelcontextprotocol/sdk`, zod, vitest.

**Spec:** `docs/superpowers/specs/2026-04-24-mcp-file-upload-design.md`.

---

## File Structure

**Create:**
- `src/upload.ts` — pure orchestrator. Validates inputs, assembles target path, delegates writes, surfaces typed errors.
- `test/unit/upload.test.ts` — domain validation, subpath sanitization, size-cap math, path assembly.
- `test/integration/upload-github.test.ts` — global `fetch` stub; asserts GitHub PUT/GET shape + error surfaces + snapshot cache invalidation.
- `test/contract/upload-contract.test.ts` — in-process MCP client → worker → mocked GitHub.

**Modify:**
- `src/github.ts` — add `fetchFileSha(path)` and `putFile(path, contentBase64, message, sha?)`. Reuse existing auth/fetch plumbing.
- `src/env.ts` — add `MAX_UPLOAD_BYTES` and `RAW_FOLDER` fields; add `maxUploadBytes(env)` and `rawFolder(env)` helpers (match existing `ttlMs` pattern).
- `src/tools.ts` — register 5th tool `wiki_upload` with dynamic description listing discovered domains.
- `wrangler.toml` — add `MAX_UPLOAD_BYTES = "26214400"` and `RAW_FOLDER = "raw"` under `[vars]`.
- `README.md` — document new tool signature, PAT scope upgrade to `contents:write`, new env vars.
- `test/helpers.ts` — extend `makeEnv()` default to include the two new vars.

---

## Task 1: Env — add MAX_UPLOAD_BYTES and RAW_FOLDER

**Files:**
- Modify: `src/env.ts`
- Modify: `test/unit/env.test.ts`
- Modify: `test/helpers.ts`

- [ ] **Step 1: Write failing test for `maxUploadBytes` helper**

Append to `test/unit/env.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- env`
Expected: FAIL — `maxUploadBytes is not a function` / `rawFolder is not a function`.

- [ ] **Step 3: Add fields to `Env` type and implement helpers**

In `src/env.ts`, add the fields to the `Env` type:

```typescript
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
  MAX_UPLOAD_BYTES?: string;
  RAW_FOLDER?: string;
};
```

Append to the bottom of `src/env.ts`:

```typescript
const DEFAULT_MAX_UPLOAD_BYTES = 26_214_400; // 25 MB
const DEFAULT_RAW_FOLDER = "raw";

export function maxUploadBytes(env: Partial<Env>): number {
  const n = parseInt(env.MAX_UPLOAD_BYTES ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return n;
}

export function rawFolder(env: Partial<Env>): string {
  const raw = (env.RAW_FOLDER ?? "").trim();
  if (!raw) return DEFAULT_RAW_FOLDER;
  // Single segment only — disallow separators/traversal.
  if (raw.includes("/") || raw.includes("\\") || raw.includes("..")) return DEFAULT_RAW_FOLDER;
  return raw;
}
```

- [ ] **Step 4: Update `makeEnv` test helper**

In `test/helpers.ts`, add the two new vars inside the `makeEnv` return object (after `GITHUB_TOKEN`):

```typescript
    MAX_UPLOAD_BYTES: "26214400",
    RAW_FOLDER: "raw",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: all tests pass, including the new env tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/env.ts test/unit/env.test.ts test/helpers.ts
git commit -m "feat(env): add MAX_UPLOAD_BYTES and RAW_FOLDER config"
```

---

## Task 2: GithubClient — `fetchFileSha`

**Files:**
- Modify: `src/github.ts`
- Modify: `test/unit/github.test.ts`

- [ ] **Step 1: Write failing test**

Append inside the existing `describe("GithubClient", ...)` block in `test/unit/github.test.ts`:

```typescript
  it("fetchFileSha returns sha when file exists", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ sha: "deadbeef", path: "personal/raw/a.pdf" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new GithubClient(makeEnv());
    const sha = await client.fetchFileSha("personal/raw/a.pdf");
    expect(sha).toBe("deadbeef");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/repos/fake/wiki/contents/personal/raw/a.pdf");
    expect(String(url)).toContain("ref=main");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-pat" });
  });

  it("fetchFileSha returns null on 404", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    const client = new GithubClient(makeEnv());
    const sha = await client.fetchFileSha("personal/raw/missing.pdf");
    expect(sha).toBeNull();
  });

  it("fetchFileSha throws on 500", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 500 }));
    const client = new GithubClient(makeEnv());
    await expect(client.fetchFileSha("personal/raw/x.pdf")).rejects.toThrow(/500/);
  });

  it("fetchFileSha percent-encodes path segments", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    const client = new GithubClient(makeEnv());
    await client.fetchFileSha("personal/raw/docs/Foo Bar.pdf");
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/contents/personal/raw/docs/Foo%20Bar.pdf");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- github`
Expected: FAIL — `client.fetchFileSha is not a function`.

- [ ] **Step 3: Implement `fetchFileSha`**

Add method to `GithubClient` class in `src/github.ts` (after `fetchBody`):

```typescript
  private contentsUrl(path: string): string {
    const [owner, repo] = this.env.GITHUB_REPO.split("/");
    const encoded = path
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}`;
  }

  async fetchFileSha(path: string): Promise<string | null> {
    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.env.GITHUB_BRANCH)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "wiki-mcp",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`GitHub contents GET failed for ${path}: ${res.status}`);
    }
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- github`
Expected: all GithubClient tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/github.ts test/unit/github.test.ts
git commit -m "feat(github): add fetchFileSha for contents API pre-check"
```

---

## Task 3: GithubClient — `putFile`

**Files:**
- Modify: `src/github.ts`
- Modify: `test/unit/github.test.ts`

- [ ] **Step 1: Write failing test**

Append inside the existing `describe("GithubClient", ...)` block in `test/unit/github.test.ts`:

```typescript
  it("putFile sends PUT without sha on create", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: { sha: "newsha", path: "personal/raw/a.pdf", html_url: "https://github.com/..." },
          commit: { sha: "commit123" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const client = new GithubClient(makeEnv());
    const res = await client.putFile("personal/raw/a.pdf", "Zm9v", "add a.pdf");

    expect(res.commit_sha).toBe("commit123");
    expect(res.content_sha).toBe("newsha");
    expect(res.html_url).toBe("https://github.com/...");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/contents/personal/raw/a.pdf");
    expect((init as RequestInit).method).toBe("PUT");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-pat" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      message: "add a.pdf",
      content: "Zm9v",
      branch: "main",
    });
    expect(body).not.toHaveProperty("sha");
    expect(body.committer).toMatchObject({ name: "wiki-mcp" });
  });

  it("putFile includes sha on update", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: { sha: "newsha", html_url: "u" },
          commit: { sha: "c" },
        }),
      ),
    );
    const client = new GithubClient(makeEnv());
    await client.putFile("personal/raw/a.pdf", "Zm9v", "update", "oldsha");
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sha).toBe("oldsha");
  });

  it("putFile throws on 401 with helpful hint", async () => {
    fetchSpy.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const client = new GithubClient(makeEnv());
    await expect(client.putFile("personal/raw/a.pdf", "Zm9v", "m")).rejects.toThrow(
      /GitHub auth failed/,
    );
  });

  it("putFile throws on 409 (sha mismatch)", async () => {
    fetchSpy.mockResolvedValue(new Response("conflict", { status: 409 }));
    const client = new GithubClient(makeEnv());
    await expect(client.putFile("personal/raw/a.pdf", "Zm9v", "m", "stale")).rejects.toThrow(
      /conflict/i,
    );
  });

  it("putFile throws on 422 surfacing GitHub message", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: "path is invalid" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new GithubClient(makeEnv());
    await expect(client.putFile("bad//path", "Zm9v", "m")).rejects.toThrow(/path is invalid/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- github`
Expected: FAIL — `client.putFile is not a function`.

- [ ] **Step 3: Implement `putFile`**

Add to `GithubClient` in `src/github.ts`, and add a matching type export:

```typescript
export type PutFileResult = {
  content_sha: string;
  commit_sha: string;
  html_url: string;
};
```

```typescript
  async putFile(
    path: string,
    contentBase64: string,
    message: string,
    sha?: string,
  ): Promise<PutFileResult> {
    const url = this.contentsUrl(path);
    const body: Record<string, unknown> = {
      message,
      content: contentBase64,
      branch: this.env.GITHUB_BRANCH,
      committer: {
        name: "wiki-mcp",
        email: "wiki-mcp@users.noreply.github.com",
      },
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "wiki-mcp",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `GitHub auth failed (${res.status}) — check GITHUB_TOKEN has contents:write`,
      );
    }
    if (res.status === 409) {
      throw new Error(`GitHub conflict (409) — file changed concurrently. Retry.`);
    }
    if (res.status === 422) {
      let detail = "";
      try {
        const j = (await res.json()) as { message?: string };
        detail = j.message ?? "";
      } catch {
        /* swallow */
      }
      throw new Error(`GitHub rejected path (422): ${detail}`);
    }
    if (!res.ok) {
      throw new Error(`GitHub PUT failed (${res.status}) for ${path}`);
    }

    const json = (await res.json()) as {
      content?: { sha?: string; html_url?: string };
      commit?: { sha?: string };
    };
    return {
      content_sha: json.content?.sha ?? "",
      commit_sha: json.commit?.sha ?? "",
      html_url: json.content?.html_url ?? "",
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- github`
Expected: all GithubClient tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/github.ts test/unit/github.test.ts
git commit -m "feat(github): add putFile for contents API create/update"
```

---

## Task 4: Upload module — subpath sanitizer + size cap (pure)

**Files:**
- Create: `src/upload.ts` (initial skeleton with two pure helpers)
- Create: `test/unit/upload.test.ts`

- [ ] **Step 1: Write failing tests for `sanitizeSubpath`**

Create `test/unit/upload.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { checkSize, sanitizeSubpath } from "../../src/upload";

describe("sanitizeSubpath", () => {
  it("accepts a normal single-file path", () => {
    expect(sanitizeSubpath("docs/2026/test.pdf")).toBe("docs/2026/test.pdf");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeSubpath("  test.pdf  ")).toBe("test.pdf");
  });

  it("collapses repeated slashes", () => {
    expect(sanitizeSubpath("docs//2026///test.pdf")).toBe("docs/2026/test.pdf");
  });

  it("rejects '..' traversal", () => {
    expect(() => sanitizeSubpath("../evil.pdf")).toThrow(/traversal/);
    expect(() => sanitizeSubpath("docs/../../evil.pdf")).toThrow(/traversal/);
  });

  it("rejects absolute paths", () => {
    expect(() => sanitizeSubpath("/docs/test.pdf")).toThrow(/traversal/);
  });

  it("rejects backslash", () => {
    expect(() => sanitizeSubpath("docs\\test.pdf")).toThrow(/traversal/);
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeSubpath("docs/test\0.pdf")).toThrow(/invalid/);
  });

  it("rejects empty subpath", () => {
    expect(() => sanitizeSubpath("")).toThrow(/empty/);
    expect(() => sanitizeSubpath("   ")).toThrow(/empty/);
  });

  it("rejects more than 8 segments", () => {
    expect(() => sanitizeSubpath("a/b/c/d/e/f/g/h/i.pdf")).toThrow(/segments/);
  });

  it("rejects a segment longer than 255 chars", () => {
    const long = `${"x".repeat(260)}.pdf`;
    expect(() => sanitizeSubpath(long)).toThrow(/segment/);
  });

  it("rejects trailing slash (not a file)", () => {
    expect(() => sanitizeSubpath("docs/")).toThrow(/segment/);
  });
});

describe("checkSize", () => {
  it("accepts base64 within cap", () => {
    const b64 = "AAAA"; // 3 raw bytes
    expect(() => checkSize(b64, 1024)).not.toThrow();
  });

  it("rejects base64 over encoded-length ceiling", () => {
    const cap = 3;
    const tooLong = "A".repeat(100);
    expect(() => checkSize(tooLong, cap)).toThrow(/too large/);
  });

  it("rejects when decoded raw bytes exceed cap", () => {
    // 12 raw bytes = 16 b64 chars, cap 11 => reject
    const b64 = Buffer.from("hello world!").toString("base64");
    expect(() => checkSize(b64, 11)).toThrow(/too large/);
  });

  it("accepts exactly at cap", () => {
    const b64 = Buffer.from("hello").toString("base64"); // 5 bytes
    expect(() => checkSize(b64, 5)).not.toThrow();
  });

  it("rejects invalid base64", () => {
    expect(() => checkSize("***not-base64***", 1024)).toThrow(/base64/);
  });

  it("rejects empty content", () => {
    expect(() => checkSize("", 1024)).toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- upload`
Expected: FAIL — `Cannot find module '../../src/upload'`.

- [ ] **Step 3: Implement `src/upload.ts` pure helpers**

Create `src/upload.ts`:

```typescript
const MAX_SEGMENTS = 8;
const MAX_SEGMENT_LEN = 255;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function sanitizeSubpath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("subpath is empty");
  if (trimmed.includes("\0")) throw new Error("invalid subpath — null byte");
  if (trimmed.includes("\\")) throw new Error("invalid subpath — traversal not allowed");
  if (trimmed.startsWith("/")) throw new Error("invalid subpath — traversal not allowed");

  const collapsed = trimmed.replace(/\/+/g, "/");
  const segments = collapsed.split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error("invalid subpath — traversal not allowed");
  }
  if (segments.length > MAX_SEGMENTS) {
    throw new Error(`invalid subpath — too many segments (max ${MAX_SEGMENTS})`);
  }
  if (segments.some((s) => s.length === 0 || s.length > MAX_SEGMENT_LEN)) {
    throw new Error(`invalid subpath — segment empty or exceeds ${MAX_SEGMENT_LEN} chars`);
  }
  return segments.join("/");
}

export function checkSize(contentBase64: string, maxRawBytes: number): void {
  if (!contentBase64) throw new Error("content_base64 is empty");
  if (!BASE64_RE.test(contentBase64)) {
    throw new Error("content_base64 is not valid base64");
  }
  const maxEncodedLen = Math.ceil(maxRawBytes / 3) * 4;
  if (contentBase64.length > maxEncodedLen) {
    throw new Error(
      `file too large: encoded ${contentBase64.length} > cap ${maxEncodedLen} chars`,
    );
  }
  const padding = contentBase64.endsWith("==") ? 2 : contentBase64.endsWith("=") ? 1 : 0;
  const rawBytes = Math.floor((contentBase64.length * 3) / 4) - padding;
  if (rawBytes > maxRawBytes) {
    throw new Error(`file too large: ${rawBytes} bytes > cap ${maxRawBytes} bytes`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- upload`
Expected: all upload unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/upload.ts test/unit/upload.test.ts
git commit -m "feat(upload): add subpath sanitizer + size-cap pure helpers"
```

---

## Task 5: Upload module — `uploadFile` orchestrator

**Files:**
- Modify: `src/upload.ts`
- Modify: `test/unit/upload.test.ts`

- [ ] **Step 1: Write failing tests for `uploadFile`**

Append to `test/unit/upload.test.ts`:

```typescript
import type { GithubClient } from "../../src/github";
import type { Snapshot } from "../../src/types";
import { uploadFile } from "../../src/upload";

function makeSnapshot(domainNames: string[]): Snapshot {
  const domains = new Map(
    domainNames.map((name) => [
      name,
      {
        name,
        indexPath: `${name}/index.md`,
        logPath: `${name}/log.md`,
        wikiTypes: new Map<string, string[]>(),
        rawPaths: [],
      },
    ]),
  );
  return {
    sha: "snap-sha",
    fetchedAt: Date.now(),
    domains,
    allPaths: [],
    schemaPaths: [],
  };
}

function makeGithubStub(overrides: Partial<GithubClient> = {}): GithubClient {
  return {
    fetchFileSha: async () => null,
    putFile: async () => ({
      content_sha: "new-sha",
      commit_sha: "commit-sha",
      html_url: "https://github.com/x/y/blob/main/personal/raw/a.pdf",
    }),
    invalidate: () => {},
    ...overrides,
  } as unknown as GithubClient;
}

describe("uploadFile", () => {
  const env = {
    GITHUB_REPO: "fake/wiki",
    GITHUB_BRANCH: "main",
    MAX_UPLOAD_BYTES: "26214400",
    RAW_FOLDER: "raw",
  } as never;

  const args = {
    domain: "personal",
    subpath: "docs/a.pdf",
    content_base64: Buffer.from("hello").toString("base64"),
  };

  it("assembles target path under {domain}/{RAW_FOLDER}/{subpath}", async () => {
    const snap = makeSnapshot(["personal"]);
    const calls: Array<{ path: string; sha?: string }> = [];
    const gh = makeGithubStub({
      putFile: (async (path: string, _content: string, _msg: string, sha?: string) => {
        calls.push({ path, sha });
        return { content_sha: "s", commit_sha: "c", html_url: "u" };
      }) as GithubClient["putFile"],
    });

    const result = await uploadFile(args, snap, gh, env);
    expect(calls[0].path).toBe("personal/raw/docs/a.pdf");
    expect(calls[0].sha).toBeUndefined();
    expect(result).toMatchObject({
      ok: true,
      path: "personal/raw/docs/a.pdf",
      commit_sha: "c",
      html_url: "u",
    });
  });

  it("passes existing sha on update", async () => {
    const snap = makeSnapshot(["personal"]);
    let receivedSha: string | undefined;
    const gh = makeGithubStub({
      fetchFileSha: (async () => "existing-sha") as GithubClient["fetchFileSha"],
      putFile: (async (_p: string, _c: string, _m: string, sha?: string) => {
        receivedSha = sha;
        return { content_sha: "s", commit_sha: "c", html_url: "u" };
      }) as GithubClient["putFile"],
    });
    await uploadFile(args, snap, gh, env);
    expect(receivedSha).toBe("existing-sha");
  });

  it("rejects unknown domain with list of valid domains", async () => {
    const snap = makeSnapshot(["personal", "work"]);
    const gh = makeGithubStub();
    await expect(
      uploadFile({ ...args, domain: "nope" }, snap, gh, env),
    ).rejects.toThrow(/unknown domain 'nope'.*personal.*work/);
  });

  it("uses custom message when provided", async () => {
    const snap = makeSnapshot(["personal"]);
    let receivedMsg = "";
    const gh = makeGithubStub({
      putFile: (async (_p: string, _c: string, msg: string) => {
        receivedMsg = msg;
        return { content_sha: "s", commit_sha: "c", html_url: "u" };
      }) as GithubClient["putFile"],
    });
    await uploadFile({ ...args, message: "custom note" }, snap, gh, env);
    expect(receivedMsg).toBe("custom note");
  });

  it("defaults message to 'chore(raw): upload {subpath}'", async () => {
    const snap = makeSnapshot(["personal"]);
    let receivedMsg = "";
    const gh = makeGithubStub({
      putFile: (async (_p: string, _c: string, msg: string) => {
        receivedMsg = msg;
        return { content_sha: "s", commit_sha: "c", html_url: "u" };
      }) as GithubClient["putFile"],
    });
    await uploadFile(args, snap, gh, env);
    expect(receivedMsg).toBe("chore(raw): upload docs/a.pdf");
  });

  it("invalidates snapshot cache after success", async () => {
    const snap = makeSnapshot(["personal"]);
    let invalidated = false;
    const gh = makeGithubStub({
      invalidate: (() => {
        invalidated = true;
      }) as GithubClient["invalidate"],
    });
    await uploadFile(args, snap, gh, env);
    expect(invalidated).toBe(true);
  });

  it("does not invalidate on failure", async () => {
    const snap = makeSnapshot(["personal"]);
    let invalidated = false;
    const gh = makeGithubStub({
      putFile: (async () => {
        throw new Error("upstream down");
      }) as GithubClient["putFile"],
      invalidate: (() => {
        invalidated = true;
      }) as GithubClient["invalidate"],
    });
    await expect(uploadFile(args, snap, gh, env)).rejects.toThrow(/upstream down/);
    expect(invalidated).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- upload`
Expected: FAIL — `uploadFile is not a function`.

- [ ] **Step 3: Implement `uploadFile`**

Append to `src/upload.ts`:

```typescript
import { maxUploadBytes, rawFolder, type Env } from "./env";
import type { GithubClient } from "./github";
import type { Snapshot } from "./types";

export type UploadArgs = {
  domain: string;
  subpath: string;
  content_base64: string;
  message?: string;
};

export type UploadResult = {
  ok: true;
  path: string;
  commit_sha: string;
  html_url: string;
};

export async function uploadFile(
  args: UploadArgs,
  snapshot: Snapshot,
  github: GithubClient,
  env: Env,
): Promise<UploadResult> {
  if (!snapshot.domains.has(args.domain)) {
    const valid = [...snapshot.domains.keys()].join(", ");
    throw new Error(`unknown domain '${args.domain}'. Valid: [${valid}]`);
  }

  const safeSubpath = sanitizeSubpath(args.subpath);
  checkSize(args.content_base64, maxUploadBytes(env));

  const target = `${args.domain}/${rawFolder(env)}/${safeSubpath}`;
  const message = args.message ?? `chore(raw): upload ${safeSubpath}`;

  const existingSha = await github.fetchFileSha(target);
  const put = await github.putFile(
    target,
    args.content_base64,
    message,
    existingSha ?? undefined,
  );

  github.invalidate();

  return {
    ok: true,
    path: target,
    commit_sha: put.commit_sha,
    html_url: put.html_url,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- upload`
Expected: all upload tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/upload.ts test/unit/upload.test.ts
git commit -m "feat(upload): add uploadFile orchestrator"
```

---

## Task 6: Tools — register `wiki_upload`

**Files:**
- Modify: `src/tools.ts`
- Modify: `test/integration/tools.test.ts` (new test case)

- [ ] **Step 1: Write failing integration test**

Append inside the existing `describe` in `test/integration/tools.test.ts` (look at existing patterns — they use `makeFixtureFetch` + `createServer`). Add:

```typescript
  it("wiki_upload validates domain against snapshot", async () => {
    const handle = await createServer(makeEnv());
    const res = await handle.callTool("wiki_upload", {
      domain: "bogus",
      subpath: "a.pdf",
      content_base64: "Zm9v",
    });
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/unknown domain 'bogus'/);
  });

  it("wiki_upload rejects malformed subpath", async () => {
    const handle = await createServer(makeEnv());
    const res = await handle.callTool("wiki_upload", {
      domain: "personal",
      subpath: "../evil.pdf",
      content_base64: "Zm9v",
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toMatch(/traversal/);
  });

  it("wiki_upload returns error when content_base64 is empty", async () => {
    const handle = await createServer(makeEnv());
    const res = await handle.callTool("wiki_upload", {
      domain: "personal",
      subpath: "a.pdf",
      content_base64: "",
    });
    expect(res.isError).toBe(true);
  });
```

Ensure the file imports `makeEnv` and `makeFixtureFetch` as existing tests do (no new imports if they already pull from `../helpers`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tools`
Expected: FAIL — tool `wiki_upload` not registered / unknown tool.

- [ ] **Step 3: Register `wiki_upload` in `src/tools.ts`**

Add import at the top of `src/tools.ts`:

```typescript
import { uploadFile } from "./upload";
```

Inside `registerTools(...)`, add after the existing `wiki_list` registration block:

```typescript
  const domainList = [...(ctx.snapshotForDescription?.domains.keys() ?? [])].join(", ");
  const uploadDesc = domainList
    ? `Upload a file to the wiki repo at {domain}/raw/{subpath}. Stored as-is (no transformation). Valid domains: [${domainList}].`
    : `Upload a file to the wiki repo at {domain}/raw/{subpath}. Stored as-is (no transformation). (No domains discovered yet.)`;

  server.registerTool(
    "wiki_upload",
    {
      description: uploadDesc,
      inputSchema: {
        domain: z.string(),
        subpath: z.string(),
        content_base64: z.string(),
        message: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => wikiUploadHandler(args, ctx),
  );
  table.set("wiki_upload", (raw) => wikiUploadHandler(raw, ctx));
```

Add the schema + handler at the bottom of `src/tools.ts`:

```typescript
const uploadSchema = z.object({
  domain: z.string(),
  subpath: z.string(),
  content_base64: z.string(),
  message: z.string().optional(),
});

async function wikiUploadHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) return errorResult(`invalid input: ${parsed.error.message}`);
  try {
    const snap = await ctx.getSnapshot();
    const result = await uploadFile(parsed.data, snap, ctx.github, ctx.env);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}
```

Extend `ToolContext` at the top of `src/tools.ts` with an optional snapshot-for-description field so the description can include discovered domains without awaiting at registration time:

```typescript
export type ToolContext = {
  env: Env;
  github: GithubClient;
  getSnapshot: () => Promise<Snapshot>;
  snapshotForDescription?: Snapshot;
};
```

- [ ] **Step 4: Thread the pre-fetched snapshot from `server.ts`**

In `src/server.ts`, the existing `createServer` already awaits `getSnapshot()` before registering tools. Capture its result and pass it into `ctx`:

Replace:

```typescript
  const { github, getSnapshot } = resolved;
  await getSnapshot();
```

with:

```typescript
  const { github, getSnapshot } = resolved;
  const initialSnapshot = await getSnapshot();
```

Replace:

```typescript
  const ctx: ToolContext & ResourceContext = { env, github, getSnapshot };
```

with:

```typescript
  const ctx: ToolContext & ResourceContext = {
    env,
    github,
    getSnapshot,
    snapshotForDescription: initialSnapshot,
  };
```

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: all tests pass, including the new `wiki_upload` tool integration cases.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/tools.ts src/server.ts test/integration/tools.test.ts
git commit -m "feat(mcp): register wiki_upload tool with dynamic domain list"
```

---

## Task 7: Integration — GithubClient end-to-end with stubbed fetch

**Files:**
- Create: `test/integration/upload-github.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `test/integration/upload-github.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubClient } from "../../src/github";
import type { Snapshot } from "../../src/types";
import { uploadFile } from "../../src/upload";
import { makeEnv } from "../helpers";

function makeSnapshot(names: string[]): Snapshot {
  const domains = new Map(
    names.map((n) => [
      n,
      {
        name: n,
        indexPath: `${n}/index.md`,
        logPath: `${n}/log.md`,
        wikiTypes: new Map<string, string[]>(),
        rawPaths: [],
      },
    ]),
  );
  return {
    sha: "snap",
    fetchedAt: Date.now(),
    domains,
    allPaths: [],
    schemaPaths: [],
  };
}

describe("uploadFile end-to-end (stubbed fetch)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  it("creates a new file: GET 404 then PUT without sha", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: { sha: "newsha", html_url: "https://example/x" },
            commit: { sha: "c1" },
          }),
        ),
      );
    const env = makeEnv();
    const gh = new GithubClient(env);
    const res = await uploadFile(
      {
        domain: "personal",
        subpath: "docs/a.pdf",
        content_base64: Buffer.from("hello").toString("base64"),
      },
      makeSnapshot(["personal"]),
      gh,
      env,
    );

    expect(res.path).toBe("personal/raw/docs/a.pdf");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, putInit] = fetchSpy.mock.calls[1];
    expect((putInit as RequestInit).method).toBe("PUT");
    expect(JSON.parse((putInit as RequestInit).body as string)).not.toHaveProperty("sha");
  });

  it("updates an existing file: GET returns sha then PUT includes it", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: "existing" }), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: { sha: "new", html_url: "u" },
            commit: { sha: "c" },
          }),
        ),
      );
    const env = makeEnv();
    const gh = new GithubClient(env);
    await uploadFile(
      {
        domain: "personal",
        subpath: "docs/a.pdf",
        content_base64: Buffer.from("x").toString("base64"),
      },
      makeSnapshot(["personal"]),
      gh,
      env,
    );
    const [, putInit] = fetchSpy.mock.calls[1];
    expect(JSON.parse((putInit as RequestInit).body as string).sha).toBe("existing");
  });

  it("propagates 401 auth errors with hint", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const env = makeEnv();
    const gh = new GithubClient(env);
    await expect(
      uploadFile(
        {
          domain: "personal",
          subpath: "a.pdf",
          content_base64: "AAAA",
        },
        makeSnapshot(["personal"]),
        gh,
        env,
      ),
    ).rejects.toThrow(/GitHub auth failed/);
  });

  it("writes to the configured branch", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: { sha: "s", html_url: "u" },
            commit: { sha: "c" },
          }),
        ),
      );
    const env = makeEnv({ GITHUB_BRANCH: "wiki" });
    const gh = new GithubClient(env);
    await uploadFile(
      {
        domain: "personal",
        subpath: "a.pdf",
        content_base64: "AAAA",
      },
      makeSnapshot(["personal"]),
      gh,
      env,
    );
    const [, putInit] = fetchSpy.mock.calls[1];
    expect(JSON.parse((putInit as RequestInit).body as string).branch).toBe("wiki");
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm test -- upload-github`
Expected: all integration cases pass.

- [ ] **Step 3: Commit**

```bash
git add test/integration/upload-github.test.ts
git commit -m "test(upload): integration coverage for create/update/auth/branch"
```

---

## Task 8: Contract test — MCP client → worker

**Files:**
- Create: `test/contract/upload-contract.test.ts`

- [ ] **Step 1: Write failing contract test**

Create `test/contract/upload-contract.test.ts`:

```typescript
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/server";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("wiki_upload MCP contract", () => {
  it("tools/list now advertises wiki_upload", async () => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
    const handle = await createServer(makeEnv());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await handle.raw.connect(serverT);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientT);

    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "wiki_context",
      "wiki_fetch",
      "wiki_list",
      "wiki_search",
      "wiki_upload",
    ]);
    const uploadTool = list.tools.find((t) => t.name === "wiki_upload");
    expect(uploadTool?.description).toMatch(/Valid domains:/);
    await client.close();
  });

  it("calling wiki_upload with unknown domain returns isError", async () => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
    const handle = await createServer(makeEnv());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await handle.raw.connect(serverT);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientT);

    const res = await client.callTool({
      name: "wiki_upload",
      arguments: { domain: "nope", subpath: "a.pdf", content_base64: "Zm9v" },
    });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("calling wiki_upload with valid input commits via GitHub PUT", async () => {
    // First: tree + raw fetches via fixture; then intercept contents API calls.
    const treeFetch = makeFixtureFetch(FIXTURES_ROOT);
    const putSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/contents/") && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            content: { sha: "new", html_url: "https://github.com/x/y/blob/main/z" },
            commit: { sha: "commit-abc" },
          }),
        );
      }
      if (url.includes("/contents/")) {
        return new Response("not found", { status: 404 });
      }
      return treeFetch(input);
    });
    globalThis.fetch = putSpy as unknown as typeof fetch;

    const handle = await createServer(makeEnv());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await handle.raw.connect(serverT);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientT);

    const res = await client.callTool({
      name: "wiki_upload",
      arguments: {
        domain: "personal",
        subpath: "docs/a.pdf",
        content_base64: Buffer.from("hello").toString("base64"),
      },
    });
    const content = res.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toMatchObject({
      ok: true,
      path: "personal/raw/docs/a.pdf",
      commit_sha: "commit-abc",
    });
    await client.close();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm test -- upload-contract`
Expected: all contract tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/contract/upload-contract.test.ts
git commit -m "test(upload): contract coverage for wiki_upload over JSON-RPC"
```

---

## Task 9: Configuration + docs

**Files:**
- Modify: `wrangler.toml`
- Modify: `README.md`

- [ ] **Step 1: Add defaults to `wrangler.toml`**

In `wrangler.toml`, extend `[vars]`:

```toml
name = "wiki-mcp"
main = "src/index.ts"
compatibility_date = "2026-04-24"

[vars]
GITHUB_REPO = "IsaiaScope/wikionfire"
GITHUB_BRANCH = "wiki"
WIKI_SERVER_NAME = "wikionfire"
CACHE_TTL_SECONDS = "60"
SCHEMA_GLOBS = "CLAUDE.md,*/CLAUDE.md,docs/llm-wiki.md"
DOMAIN_REQUIRED_FILES = "index.md,log.md"
MAX_UPLOAD_BYTES = "26214400"
RAW_FOLDER = "raw"
```

- [ ] **Step 2: Update README — tool list**

In `README.md`, under "Exposes four MCP tools:", change "four" to "five" and add a bullet after `wiki_list`:

```markdown
- **`wiki_upload(domain, subpath, content_base64, message?)`** — upload any file (PDF, image, text, binary) to `{domain}/raw/{subpath}` in the wiki repo. Stored as-is, no transformation. Max 25 MB.
```

- [ ] **Step 3: Update README — PAT scope**

In `README.md`, under "Creating the GitHub PAT" step 4, change:

```markdown
4. Permissions → Repository permissions → **Contents: Read-only**.
```

to:

```markdown
4. Permissions → Repository permissions → **Contents: Read and write** (write is required by `wiki_upload`; leave at read-only if you never plan to call it).
```

- [ ] **Step 4: Update README — configuration table**

In `README.md`, add two rows to the config table after `DOMAIN_REQUIRED_FILES`:

```markdown
| `MAX_UPLOAD_BYTES` | `wrangler.toml [vars]` | Max upload size in bytes (default 26214400 = 25 MB) |
| `RAW_FOLDER` | `wrangler.toml [vars]` | Subfolder under each domain for uploads (default `raw`) |
```

- [ ] **Step 5: Run full test suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml README.md
git commit -m "docs(upload): document wiki_upload tool, PAT scope, new env vars"
```

---

## Verification checklist

Run each of these after Task 9:

- [ ] `pnpm test` — all tests green (85 existing + new cases).
- [ ] `pnpm typecheck` — no errors.
- [ ] `pnpm lint` — no errors.
- [ ] `pnpm test:coverage` — `src/upload.ts` coverage ≥ 90%, new GithubClient methods ≥ 90%.
- [ ] `tools/list` advertises 5 tools (verify via contract test output).
- [ ] Deployment note: before promoting to prod, upgrade the `GITHUB_TOKEN` PAT from `Contents: Read-only` to `Contents: Read and write`, otherwise every upload returns `GitHub auth failed`.

---

## Notes for executor

- The codebase uses `biome` + `ultracite`; `pnpm fix` will auto-format after edits.
- Husky pre-commit runs lint-staged; do not use `--no-verify`.
- Post-commit hook auto-bumps `package.json` version; that's expected and amends the same commit.
- Existing test pyramid: unit → integration → contract. Match existing naming and styles.
- `parseCsv`, `ttlMs` in `src/env.ts` show the helper pattern to follow for `maxUploadBytes`/`rawFolder`.
- `GithubClient.fetchTree` shows the header pattern; reuse exactly (`Accept`, `X-GitHub-Api-Version`, `User-Agent`).
- `test/contract/mcp.test.ts` shows the in-process JSON-RPC pattern for the contract test.
