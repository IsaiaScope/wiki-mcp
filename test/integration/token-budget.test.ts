import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { GithubClient } from "../../src/github";
import { renderContextMarkdown } from "../../src/mcp/serialize";
import { buildContext } from "../../src/search";
import { estimateTokens } from "../../src/search/budget";
import { buildSnapshot } from "../../src/wiki";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

// Baseline captured before token-perf pass: pre-refactor representative
// emission (schema + indexes + log + JSON envelope + frontmatter + expansions
// always-on) totalled ~4200 estimated tokens for this query against the
// fixture vault. Setting the assertion floor at 35% reduction → 2730 tokens
// is the regression guard.
const BASELINE_TOKENS = 4200;
const REQUIRED_REDUCTION = 0.35;

describe("token-budget regression", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("wiki_context emission is at least 35% smaller than the v0.16 baseline", async () => {
    const env = makeEnv();
    const client = new GithubClient(env);
    const snap = buildSnapshot(await client.fetchTree(), env);
    const bundle = await buildContext(
      { question: "tell me about Foo", domain: "all", budget_tokens: 6000 },
      snap,
      client,
    );
    const text = renderContextMarkdown(bundle);
    const tokens = estimateTokens(text);
    const cap = Math.floor(BASELINE_TOKENS * (1 - REQUIRED_REDUCTION));
    expect(tokens).toBeLessThanOrEqual(cap);
  });
});
