import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("MCP tools", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("tools/list returns six tools", async () => {
    const server = await createServer(makeEnv());
    const names = server.listToolNames();
    expect(names.sort()).toEqual([
      "wiki_context",
      "wiki_fetch",
      "wiki_list",
      "wiki_read_raw",
      "wiki_search",
      "wiki_upload",
    ]);
  });

  it("wiki_context returns markdown text", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_context", { question: "Foo" });
    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    expect(text.startsWith("# wiki_context")).toBe(true);
    expect(text).toContain("[hit] ");
    expect(text).toContain("[cite] ");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("wiki_search returns ranked list", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_search", { query: "Foo", limit: 5 });
    const rows = JSON.parse(result.content[0].text);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0]).toHaveProperty("p");
    expect(rows[0]).toHaveProperty("t");
    expect(rows[0]).toHaveProperty("s");
    expect(typeof rows[0].s).toBe("number");
  });

  it("wiki_search re-ranks via body — finds tag/body matches absent from path", async () => {
    const server = await createServer(makeEnv());
    // "sample" exists only in frontmatter tags + body, never in path
    const result = await server.callTool("wiki_search", { query: "sample", limit: 5 });
    const parsed = JSON.parse(result.content[0].text) as Array<{ p: string }>;
    const paths = parsed.map((p) => p.p);
    expect(paths).toContain("personal/wiki/entities/Foo.md");
  });

  it("wiki_search finds page via frontmatter alias", async () => {
    const server = await createServer(makeEnv());
    // Foo.md frontmatter declares aliases: [Fooable]
    const result = await server.callTool("wiki_search", { query: "Fooable", limit: 5 });
    const parsed = JSON.parse(result.content[0].text) as Array<{ p: string }>;
    const paths = parsed.map((p) => p.p);
    expect(paths).toContain("personal/wiki/entities/Foo.md");
  });

  it("wiki_fetch returns bodies by path", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_fetch", {
      paths: ["personal/wiki/entities/Foo.md"],
    });
    const rows = JSON.parse(result.content[0].text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("p");
    expect(rows[0]).toHaveProperty("c");
    expect(rows[0]).toHaveProperty("fm");
  });

  it("wiki_list returns discovered types in paginated envelope", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_list", { domain: "personal", type: "entities" });
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toHaveProperty("g");
    expect(payload).toHaveProperty("tot");
    expect(payload).toHaveProperty("off");
    expect(payload).toHaveProperty("lim");
    expect(payload).toHaveProperty("tr");
    expect(Object.keys(payload.g).length).toBeGreaterThan(0);
  });

  it("wiki_list filters by frontmatter tag", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_list", { tag: "sample" });
    const payload = JSON.parse(result.content[0].text) as {
      g: Record<string, Record<string, Array<{ p: string }>>>;
      tot: number;
    };
    // Collect all paths from grouped structure
    const paths: string[] = [];
    for (const domain of Object.values(payload.g)) {
      for (const rows of Object.values(domain)) {
        for (const row of rows) paths.push(row.p);
      }
    }
    paths.sort();
    // Foo + bar-baz both carry tags: [sample]
    expect(paths).toEqual(["personal/wiki/concepts/bar-baz.md", "personal/wiki/entities/Foo.md"]);
  });

  it("wiki_list tag filter is case-insensitive", async () => {
    const server = await createServer(makeEnv());
    // Tag is "sample" in fixtures; query upper-cased should still match.
    const result = await server.callTool("wiki_list", { tag: "SAMPLE" });
    const payload = JSON.parse(result.content[0].text) as { tot: number };
    expect(payload.tot).toBeGreaterThan(0);
  });

  it("wiki_list domain='all' is equivalent to omitted domain", async () => {
    const server = await createServer(makeEnv());
    const a = JSON.parse(
      (await server.callTool("wiki_list", { domain: "all" })).content[0].text,
    ) as { tot: number; g: Record<string, Record<string, unknown[]>> };
    const b = JSON.parse((await server.callTool("wiki_list", {})).content[0].text) as {
      tot: number;
      g: Record<string, Record<string, unknown[]>>;
    };
    expect(a.tot).toBe(b.tot);
    expect(a.tot).toBeGreaterThan(0);
  });

  it("wiki_list applies limit + offset and reports truncated flag", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_list", { limit: 1, offset: 0 });
    const payload = JSON.parse(result.content[0].text) as {
      g: Record<string, Record<string, unknown[]>>;
      tot: number;
      tr: boolean;
    };
    // Sum row counts across all domain→type buckets
    let paged = 0;
    for (const domain of Object.values(payload.g)) {
      for (const rows of Object.values(domain)) paged += rows.length;
    }
    expect(paged).toBe(1);
    expect(payload.tot).toBeGreaterThan(1);
    expect(payload.tr).toBe(true);
  });

  it("wiki_list with unknown tag returns empty items array", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_list", { tag: "no-such-tag" });
    const payload = JSON.parse(result.content[0].text) as {
      g: Record<string, Record<string, unknown[]>>;
      tot: number;
    };
    expect(payload.tot).toBe(0);
    expect(Object.keys(payload.g).length).toBe(0);
  });

  it("wiki_fetch rejects more than 20 paths with isError", async () => {
    const server = await createServer(makeEnv());
    const paths = Array.from({ length: 21 }, (_, i) => `p${i}.md`);
    const result = await server.callTool("wiki_fetch", { paths });
    expect(result.isError).toBe(true);
  });

  it("wiki_fetch strips SENSITIVE_FRONTMATTER_KEYS from output", async () => {
    const server = await createServer(makeEnv({ SENSITIVE_FRONTMATTER_KEYS: "kind,first_seen" }));
    const result = await server.callTool("wiki_fetch", {
      paths: ["personal/wiki/entities/Foo.md"],
    });
    const rows = JSON.parse(result.content[0].text) as Array<{
      p: string;
      fm: Record<string, unknown>;
    }>;
    expect(rows[0].fm).not.toHaveProperty("kind");
    expect(rows[0].fm).not.toHaveProperty("first_seen");
    expect(rows[0].fm).toHaveProperty("type", "entity");
  });

  it("wiki_fetch rejects paths not in snapshot per-path", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_fetch", {
      paths: ["secret/file.md", "personal/wiki/entities/Foo.md"],
    });
    const rows = JSON.parse(result.content[0].text) as Array<{
      p: string;
      c?: string;
      fm?: Record<string, unknown>;
      err?: string;
    }>;
    const known = rows.find((r) => r.p === "personal/wiki/entities/Foo.md");
    const unknown = rows.find((r) => r.p === "secret/file.md");
    expect(known?.c).not.toBe("");
    expect(unknown?.err).toMatch(/not in snapshot/);
    expect(unknown).not.toHaveProperty("c");
    expect(unknown).not.toHaveProperty("fm");
  });

  it("wiki_upload rejects unknown domain", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_upload", {
      domain: "bogus",
      subpath: "a.pdf",
      content_base64: "Zm9v",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown domain 'bogus'/);
  });

  it("wiki_upload rejects malformed subpath", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_upload", {
      domain: "personal",
      subpath: "../evil.pdf",
      content_base64: "Zm9v",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/traversal/);
  });

  it("wiki_read_raw returns base64 of a raw file", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_read_raw", {
      path: "personal/raw/note.pdf",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text) as {
      ok: boolean;
      path: string;
      content_base64: string;
      bytes: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toBe("personal/raw/note.pdf");
    expect(parsed.bytes).toBeGreaterThan(0);
    // base64 round-trip
    const decoded = Buffer.from(parsed.content_base64, "base64").toString("binary");
    expect(decoded).toContain("FAKE PDF BYTES");
  });

  it("wiki_read_raw rejects path outside raw/", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_read_raw", {
      path: "personal/wiki/entities/Foo.md",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/under personal\/raw\//);
  });

  it("wiki_read_raw rejects unknown path", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_read_raw", {
      path: "secret/raw/x.pdf",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not in snapshot/);
  });

  it("wiki_upload rejects empty content", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_upload", {
      domain: "personal",
      subpath: "a.pdf",
      content_base64: "",
    });
    expect(result.isError).toBe(true);
  });
});
