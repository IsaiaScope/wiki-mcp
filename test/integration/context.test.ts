import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { GithubClient } from "../../src/github";
import { buildContext } from "../../src/search";
import { buildSnapshot } from "../../src/wiki";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

describe("wiki_context orchestrator", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("returns a bundle with hits only and citation instructions", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const tree = await client.fetchTree();
    const snap = buildSnapshot(tree, env);

    const bundle = await buildContext(
      { question: "tell me about Foo", domain: "all", budget_tokens: 4000 },
      snap,
      client,
    );

    expect(bundle).not.toHaveProperty("schema");
    expect(bundle).not.toHaveProperty("indexes");
    expect(bundle).not.toHaveProperty("recent_log");
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
      { question: "Foo", domain: "personal", budget_tokens: 4000, expand_links: true },
      snap,
      client,
    );
    const expanded = bundle.hits.find((h) => h.path === "personal/wiki/concepts/bar-baz.md");
    expect(expanded?.viaParent).toBe("personal/wiki/entities/Foo.md");
  });

  it("respects domain filter for direct hits (expansions may cross domains)", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Qux", domain: "work", budget_tokens: 4000, expand_links: true },
      snap,
      client,
    );
    // Direct hits (no viaParent) stay in the filtered domain.
    const directHits = bundle.hits.filter((h) => !h.viaParent);
    expect(directHits.every((h) => h.path.startsWith("work/"))).toBe(true);
  });

  it("surfaces cross-domain linked pages as expansions even under a domain filter", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Qux", domain: "work", budget_tokens: 4000, expand_links: true },
      snap,
      client,
    );
    // Direct hits stay in work/
    expect(bundle.hits.some((h) => h.path.startsWith("work/"))).toBe(true);
    // Qux links to personal/wiki/entities/Foo.md → should surface as expansion
    expect(
      bundle.hits.some(
        (h) =>
          h.path === "personal/wiki/entities/Foo.md" && h.viaParent === "work/wiki/entities/Qux.md",
      ),
    ).toBe(true);
    // And the linked body should be in the bundle
    expect(bundle.hits.some((h) => h.path === "personal/wiki/entities/Foo.md")).toBe(true);
  });

  it("expand_links default false: no expansion hits emitted", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Foo", domain: "personal", budget_tokens: 4000 },
      snap,
      client,
    );
    expect(bundle.hits.every((h) => !h.viaParent)).toBe(true);
  });

  it("clamps to budget_tokens and marks truncation", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Foo bar-baz concept entity", domain: "all", budget_tokens: 10 },
      snap,
      client,
    );
    // Every hit must carry a `truncated` flag; with a tight budget at least
    // one body should be clipped or only a single short hit fits.
    expect(bundle.hits.every((h) => typeof h.truncated === "boolean")).toBe(true);
    const hasTrunc =
      bundle.hits.some((h) => h.truncated) ||
      bundle.hits.some((h) => h.body.includes("[…truncated"));
    expect(hasTrunc || bundle.hits.length <= 1).toBe(true);
  });

  it("emits truncated:false for hits that fit budget", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Foo", domain: "all", budget_tokens: 10000 },
      snap,
      client,
    );
    expect(bundle.hits.length).toBeGreaterThan(0);
    expect(bundle.hits.every((h) => typeof h.truncated === "boolean")).toBe(true);
    expect(bundle.hits.some((h) => h.truncated === false)).toBe(true);
  });

  it("strips frontmatter from hit bodies (redactBody)", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "Foo", domain: "all", budget_tokens: 10000 },
      snap,
      client,
    );
    // No hit body should begin with a YAML frontmatter delimiter; the helper
    // redactBody must strip the leading `---\n…\n---\n` block before output.
    for (const h of bundle.hits) {
      expect(h.body.startsWith("---")).toBe(false);
    }
  });
});
