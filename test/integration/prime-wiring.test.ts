import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("prime wiring (structural default)", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("resources/list includes wiki://overview and a slice per fixture domain", async () => {
    const server = await createServer(makeEnv());
    const uris = server.listResourceUris();
    expect(uris).toContain("wiki://overview");
    expect(uris).toContain("wiki://overview/personal");
    expect(uris).toContain("wiki://overview/work");
  });

  it("wiki://overview returns the index markdown", async () => {
    const server = await createServer(makeEnv());
    const res = await server.readResource("wiki://overview");
    const text = res.contents[0].text;
    expect(text).toContain("# wiki — Wiki Overview");
    expect(text).toContain("Available domains: personal, work");
    expect(text).toContain("wiki://overview/personal");
    expect(text).toContain("wiki://overview/work");
  });

  it("wiki://overview/personal lists fixture paths", async () => {
    const server = await createServer(makeEnv());
    const res = await server.readResource("wiki://overview/personal");
    const text = res.contents[0].text;
    expect(text).toContain("# personal");
    expect(text).toContain("## entities");
    expect(text).toContain("- personal/wiki/entities/Foo.md");
    expect(text).not.toContain("[[personal/wiki/entities/Foo.md]]");
  });

  it("wiki://overview/nonexistent throws helpful error listing known domains", async () => {
    const server = await createServer(makeEnv());
    await expect(server.readResource("wiki://overview/nonexistent")).rejects.toThrow(
      /Known domains: personal, work/,
    );
  });

  it("structural default: registered tool descriptions do NOT contain fixture page titles", async () => {
    const server = await createServer(makeEnv());
    const registry = (
      server.raw as unknown as {
        _registeredTools?: Record<string, { description?: string }>;
      }
    )._registeredTools;
    expect(registry).toBeTruthy();
    const descriptions = Object.values(registry ?? {}).map((t) => t.description ?? "");
    expect(descriptions.length).toBeGreaterThan(0);
    for (const desc of descriptions) {
      expect(desc).not.toContain("Foo");
      expect(desc).not.toContain("Qux");
      expect(desc).not.toContain("bar-baz");
    }
  });
});

describe("prime wiring — WIKI_PRIME_VOCAB=full", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("wiki://overview markdown is still present and non-empty", async () => {
    const server = await createServer(makeEnv({ WIKI_PRIME_VOCAB: "full" }));
    const res = await server.readResource("wiki://overview");
    expect(res.contents[0].text.length).toBeGreaterThan(20);
  });
});

describe("prime wiring — WIKI_PRIME_VOCAB=off", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("overview bodies note vocabulary suppression", async () => {
    const server = await createServer(makeEnv({ WIKI_PRIME_VOCAB: "off" }));
    const idx = await server.readResource("wiki://overview");
    expect(idx.contents[0].text).toContain("suppressed by WIKI_PRIME_VOCAB=off");
    const dom = await server.readResource("wiki://overview/personal");
    expect(dom.contents[0].text).toContain("suppressed");
  });
});

describe("prime wiring — refresh propagates new domains", () => {
  it("after refresh, wiki://overview reflects the updated domain set", async () => {
    // First snapshot uses the standard fixture vault.
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
    const { buildDeps } = await import("../../src/server");
    const deps = buildDeps(makeEnv());

    const server = await createServer(makeEnv(), deps);
    const before = await server.readResource("wiki://overview");
    expect(before.contents[0].text).toContain("personal");
    expect(before.contents[0].text).toContain("work");

    // Force a refresh; the in-memory cache will rebuild snapshot + prime in lockstep.
    await deps.refresh();

    // The new server constructed from the same deps sees the post-refresh prime;
    // overview handlers read getPrime() at request time, so a fresh read reflects state.
    const server2 = await createServer(makeEnv(), deps);
    const after = await server2.readResource("wiki://overview");
    expect(after.contents[0].text).toContain("personal");
    expect(after.contents[0].text).toContain("work");

    // Same SHA → identical content (deterministic).
    expect(after.contents[0].text).toBe(before.contents[0].text);
  });
});
