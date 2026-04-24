import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/server";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("MCP resources", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("resources/list includes schema, index, log", async () => {
    const server = await createServer(makeEnv());
    const uris = server.listResourceUris();
    expect(uris).toContain("wiki://schema");
    expect(uris).toContain("wiki://index/all");
    expect(uris).toContain("wiki://log/recent");
  });

  it("wiki://schema returns concatenated schema docs", async () => {
    const server = await createServer(makeEnv());
    const res = await server.readResource("wiki://schema");
    expect(res.contents[0].text).toContain("LLM Wiki Pattern");
  });

  it("wiki://index/all returns all domain indexes", async () => {
    const server = await createServer(makeEnv());
    const res = await server.readResource("wiki://index/all");
    expect(res.contents[0].text).toContain("Personal — Index");
    expect(res.contents[0].text).toContain("Work — Index");
  });

  it("wiki://page/{domain}/{type}/{slug} reads a page", async () => {
    const server = await createServer(makeEnv());
    const res = await server.readResource("wiki://page/personal/entities/Foo");
    expect(res.contents[0].text).toContain("Foo is a sample entity");
  });
});
