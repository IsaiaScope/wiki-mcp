import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { GithubClient } from "../../src/github";
import { buildContext } from "../../src/search";
import { buildSnapshot } from "../../src/wiki";
import { makeEnv, makeFixtureFetch } from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../fixtures/vault");

type Probe = {
  question: string;
  domain: "all" | string;
  expectedTop: string[]; // paths that MUST appear in top-3
};

const PROBES: Probe[] = [
  {
    question: "tell me about Foo",
    domain: "personal",
    expectedTop: ["personal/wiki/entities/Foo.md"],
  },
  { question: "Qux entity", domain: "work", expectedTop: ["work/wiki/entities/Qux.md"] },
  {
    question: "bar baz concept",
    domain: "personal",
    expectedTop: ["personal/wiki/concepts/bar-baz.md"],
  },
  { question: "Foo", domain: "all", expectedTop: ["personal/wiki/entities/Foo.md"] },
  // Additional probes: gives work ≥2, covers sources type, alternate Foo wording
  {
    question: "Qux work entity",
    domain: "work",
    expectedTop: ["work/wiki/entities/Qux.md"],
  },
  {
    question: "sample source",
    domain: "personal",
    expectedTop: ["personal/wiki/sources/2026-01-01-sample.md"],
  },
  {
    question: "Foo entity",
    domain: "personal",
    expectedTop: ["personal/wiki/entities/Foo.md"],
  },
];

describe("answerability regression — top-3 retrieval", () => {
  beforeEach(() => {
    globalThis.fetch = makeFixtureFetch(FIXTURES_ROOT) as unknown as typeof fetch;
  });

  for (const probe of PROBES) {
    it(`top-3 contains expected paths: "${probe.question}" in ${probe.domain}`, async () => {
      const env = makeEnv();
      const client = new GithubClient(env);
      const snap = buildSnapshot(await client.fetchTree(), env);
      const bundle = await buildContext(
        { question: probe.question, domain: probe.domain, budget_tokens: 6000 },
        snap,
        client,
      );
      const top3 = bundle.hits.slice(0, 3).map((h) => h.path);
      for (const required of probe.expectedTop) {
        expect(top3).toContain(required);
      }
    });
  }
});
