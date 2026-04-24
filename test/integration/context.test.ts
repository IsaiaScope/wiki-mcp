import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContext } from "../../src/context";
import { buildSnapshot } from "../../src/discover";
import { GithubClient } from "../../src/github";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("wiki_context orchestrator", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("returns a bundle with schema, indexes, log tail, and hits for a Foo query", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const tree = await client.fetchTree();
    const snap = buildSnapshot(tree, env);

    const bundle = await buildContext(
      { question: "tell me about Foo", domain: "all", budget_tokens: 4000 },
      snap,
      client,
      env,
    );

    expect(bundle.schema).toContain("LLM Wiki Pattern");
    expect(bundle.indexes).toHaveProperty("personal");
    expect(bundle.indexes).toHaveProperty("work");
    expect(bundle.hits.length).toBeGreaterThan(0);
    const paths = bundle.hits.map((h) => h.path);
    expect(paths).toContain("personal/wiki/entities/Foo.md");
    expect(bundle.citation_instructions).toMatch(/\[\[path\]\]/);
  });

  it("expands one-hop wikilinks in hits", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Foo", domain: "personal", budget_tokens: 4000 },
      snap,
      client,
      env,
    );
    const fooHit = bundle.hits.find((h) => h.path === "personal/wiki/entities/Foo.md")!;
    expect(fooHit.links_expanded).toContain("personal/wiki/concepts/bar-baz.md");
  });

  it("respects domain filter: work query never returns personal pages", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Qux", domain: "work", budget_tokens: 4000 },
      snap,
      client,
      env,
    );
    expect(bundle.hits.every((h) => h.path.startsWith("work/"))).toBe(true);
  });

  it("clamps to budget_tokens and marks truncation", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Foo bar-baz concept entity", domain: "all", budget_tokens: 50 },
      snap,
      client,
      env,
    );
    const hasTrunc = bundle.hits.some((h) => h.body.includes("[…truncated"));
    expect(hasTrunc || bundle.hits.length <= 1).toBe(true);
  });
});
