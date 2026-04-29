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

// Tight ceiling: actual emission for this fixture query is ~58 tokens.
// Allow 2x headroom for fixture additions, but no more — anything larger
// is a regression worth investigating.
const TOKEN_CEILING = 120;

describe("token-budget regression", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  it("wiki_context emission stays within tight ceiling (regression guard)", async () => {
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
    expect(tokens).toBeLessThanOrEqual(TOKEN_CEILING);
  });
});
