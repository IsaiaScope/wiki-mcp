import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("MCP contract", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("tools/list over real JSON-RPC returns 4 tools with schemas", async () => {
    const handle = await createServer(makeEnv());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await handle.raw.connect(serverT);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientT);

    const list = await client.listTools();
    const names = list.tools.map(t => t.name).sort();
    expect(names).toEqual(["wiki_context", "wiki_fetch", "wiki_list", "wiki_search"]);
    for (const t of list.tools) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
    }

    await client.close();
  });

  it("calling wiki_context over real JSON-RPC returns a bundle", async () => {
    const handle = await createServer(makeEnv());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await handle.raw.connect(serverT);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientT);

    const res = await client.callTool({ name: "wiki_context", arguments: { question: "Foo" } });
    const content = res.content as Array<{ type: string; text: string }>;
    const bundle = JSON.parse(content[0].text);
    expect(bundle).toHaveProperty("hits");
    await client.close();
  });

  it("resources/list includes schema, index, log", async () => {
    const handle = await createServer(makeEnv());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await handle.raw.connect(serverT);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientT);

    const list = await client.listResources();
    const uris = list.resources.map(r => r.uri);
    expect(uris).toContain("wiki://schema");
    expect(uris).toContain("wiki://index/all");
    expect(uris).toContain("wiki://log/recent");

    await client.close();
  });

  it("server exposes 'instructions' containing server name on initialize", async () => {
    const handle = await createServer(makeEnv({ WIKI_SERVER_NAME: "contract-test" }));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await handle.raw.connect(serverT);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientT);
    const instructions = client.getInstructions();
    expect(String(instructions)).toMatch(/contract-test/);
    await client.close();
  });
});
