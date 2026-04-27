import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/server";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("wiki_upload MCP contract", () => {
  it("tools/list now advertises wiki_upload with domain hint", async () => {
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
    const treeFetch = makeFixtureFetch(FIXTURES_ROOT);
    const putSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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
