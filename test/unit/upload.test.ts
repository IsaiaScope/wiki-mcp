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
    expect(() => checkSize("AAAA", 1024)).not.toThrow();
  });

  it("rejects base64 over encoded-length ceiling", () => {
    expect(() => checkSize("A".repeat(100), 3)).toThrow(/too large/);
  });

  it("rejects when decoded raw bytes exceed cap", () => {
    const b64 = Buffer.from("hello world!").toString("base64");
    expect(() => checkSize(b64, 11)).toThrow(/too large/);
  });

  it("accepts exactly at cap", () => {
    const b64 = Buffer.from("hello").toString("base64");
    expect(() => checkSize(b64, 5)).not.toThrow();
  });

  it("rejects invalid base64", () => {
    expect(() => checkSize("***not-base64***", 1024)).toThrow(/base64/);
  });

  it("rejects empty content", () => {
    expect(() => checkSize("", 1024)).toThrow(/empty/);
  });
});

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
    await expect(uploadFile({ ...args, domain: "nope" }, snap, gh, env)).rejects.toThrow(
      /unknown domain 'nope'.*personal.*work/,
    );
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
