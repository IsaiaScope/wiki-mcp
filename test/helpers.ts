import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadFixtureTree(): unknown {
  const p = resolve(__dirname, "fixtures/tree.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

export function makeEnv(overrides: Record<string, string> = {}) {
  return {
    GITHUB_REPO: "fake/wiki",
    GITHUB_BRANCH: "main",
    WIKI_SERVER_NAME: "wiki",
    CACHE_TTL_SECONDS: "60",
    SCHEMA_GLOBS: "CLAUDE.md,*/CLAUDE.md,docs/llm-wiki.md",
    DOMAIN_REQUIRED_FILES: "index.md,log.md",
    MCP_BEARER: "test-bearer",
    GITHUB_TOKEN: "test-pat",
    ...overrides,
  };
}

export function makeFixtureFetch(fixturesRoot: string) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("/git/trees/")) {
      return new Response(JSON.stringify(loadFixtureTree()), {
        headers: { "content-type": "application/json" },
      });
    }

    // raw.githubusercontent.com/<owner>/<repo>/<sha>/<encoded path>
    const m = url.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
    if (m) {
      const path = decodeURIComponent(m[1]);
      const full = `${fixturesRoot}/${path}`;
      if (existsSync(full)) return new Response(readFileSync(full, "utf8"));
      return new Response("not found", { status: 404 });
    }

    return new Response("not mocked", { status: 404 });
  };
}
