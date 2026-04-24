import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubClient } from "../../src/github";
import { loadFixtureTree, makeEnv } from "../helpers";

describe("GithubClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  it("fetches tree recursively with bearer header", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(loadFixtureTree()), {
        headers: { "content-type": "application/json" },
      }),
    );

    const client = new GithubClient(makeEnv());
    const tree = await client.fetchTree();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/repos/fake/wiki/git/trees/main");
    expect(String(url)).toContain("recursive=1");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-pat" });
    expect(tree.sha).toBe("abc123sha");
    expect(tree.tree.length).toBe(12);
  });

  it("builds raw URL pinned by SHA", () => {
    const client = new GithubClient(makeEnv());
    const url = client.rawUrl("abc123sha", "personal/wiki/entities/Foo.md");
    expect(url).toBe(
      "https://raw.githubusercontent.com/fake/wiki/abc123sha/personal/wiki/entities/Foo.md",
    );
  });

  it("encodes spaces in path for raw URL", () => {
    const client = new GithubClient(makeEnv());
    const url = client.rawUrl("abc", "personal/wiki/entities/Fincons S.p.A..md");
    expect(url).toContain("Fincons%20S.p.A..md");
  });

  it("caches snapshot for TTL then refetches", async () => {
    const treeJson = JSON.stringify(loadFixtureTree());
    fetchSpy.mockImplementation(async () => new Response(treeJson));

    const client = new GithubClient(makeEnv({ CACHE_TTL_SECONDS: "1" }));
    await client.fetchTree();
    await client.fetchTree();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);
    await client.fetchTree();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("fetches raw body and returns text", async () => {
    fetchSpy.mockResolvedValue(new Response("# Foo\nbody here"));
    const client = new GithubClient(makeEnv());
    const body = await client.fetchBody("abc", "personal/wiki/entities/Foo.md");
    expect(body).toBe("# Foo\nbody here");
  });

  it("throws on non-OK tree response", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 500 }));
    const client = new GithubClient(makeEnv());
    await expect(client.fetchTree()).rejects.toThrow(/GitHub tree fetch failed: 500/);
  });
});
