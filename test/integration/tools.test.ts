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

  it("tools/list returns four tools", async () => {
    const server = await createServer(makeEnv());
    const names = server.listToolNames();
    expect(names.sort()).toEqual(["wiki_context", "wiki_fetch", "wiki_list", "wiki_search"]);
  });

  it("wiki_context returns JSON bundle text", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_context", { question: "Foo" });
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hits.length).toBeGreaterThan(0);
  });

  it("wiki_search returns ranked list", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_search", { query: "Foo", limit: 5 });
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("path");
    expect(parsed[0]).toHaveProperty("score");
  });

  it("wiki_fetch returns bodies by path", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_fetch", {
      paths: ["personal/wiki/entities/Foo.md"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].path).toBe("personal/wiki/entities/Foo.md");
    expect(parsed[0].content).toContain("Foo");
    expect(parsed[0].frontmatter).toHaveProperty("type", "entity");
  });

  it("wiki_list returns discovered types", async () => {
    const server = await createServer(makeEnv());
    const result = await server.callTool("wiki_list", { domain: "personal", type: "entities" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0]).toHaveProperty("path", "personal/wiki/entities/Foo.md");
    expect(parsed[0]).toHaveProperty("title");
  });

  it("wiki_fetch rejects more than 20 paths with isError", async () => {
    const server = await createServer(makeEnv());
    const paths = Array.from({ length: 21 }, (_, i) => `p${i}.md`);
    const result = await server.callTool("wiki_fetch", { paths });
    expect(result.isError).toBe(true);
  });
});
