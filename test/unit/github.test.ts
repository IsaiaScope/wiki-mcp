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

  it("caches fetchBody by sha+path within TTL", async () => {
    fetchSpy.mockResolvedValue(new Response("body-v1"));
    const client = new GithubClient(makeEnv({ CACHE_TTL_SECONDS: "60" }));
    await client.fetchBody("abc", "p.md");
    await client.fetchBody("abc", "p.md");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fetchBody cache distinguishes by sha", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("v1"));
    fetchSpy.mockResolvedValueOnce(new Response("v2"));
    const client = new GithubClient(makeEnv());
    const a = await client.fetchBody("sha-a", "p.md");
    const b = await client.fetchBody("sha-b", "p.md");
    expect(a).toBe("v1");
    expect(b).toBe("v2");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("invalidate() drops body cache", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("v1"));
    fetchSpy.mockResolvedValueOnce(new Response("v2"));
    const client = new GithubClient(makeEnv());
    await client.fetchBody("abc", "p.md");
    client.invalidate();
    await client.fetchBody("abc", "p.md");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws on non-OK tree response", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 500 }));
    const client = new GithubClient(makeEnv());
    await expect(client.fetchTree()).rejects.toThrow(/GitHub tree fetch failed: 500/);
  });

  it("fetchFileSha returns sha when file exists", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ sha: "deadbeef", path: "personal/raw/a.pdf" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new GithubClient(makeEnv());
    const sha = await client.fetchFileSha("personal/raw/a.pdf");
    expect(sha).toBe("deadbeef");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/repos/fake/wiki/contents/personal/raw/a.pdf");
    expect(String(url)).toContain("ref=main");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-pat" });
  });

  it("fetchFileSha returns null on 404", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    const client = new GithubClient(makeEnv());
    const sha = await client.fetchFileSha("personal/raw/missing.pdf");
    expect(sha).toBeNull();
  });

  it("fetchFileSha throws on 500", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 500 }));
    const client = new GithubClient(makeEnv());
    await expect(client.fetchFileSha("personal/raw/x.pdf")).rejects.toThrow(/500/);
  });

  it("fetchFileSha percent-encodes path segments", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    const client = new GithubClient(makeEnv());
    await client.fetchFileSha("personal/raw/docs/Foo Bar.pdf");
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/contents/personal/raw/docs/Foo%20Bar.pdf");
  });

  it("putFile sends PUT without sha on create", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: { sha: "newsha", path: "personal/raw/a.pdf", html_url: "https://github.com/x" },
          commit: { sha: "commit123" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const client = new GithubClient(makeEnv());
    const res = await client.putFile("personal/raw/a.pdf", "Zm9v", "add a.pdf");

    expect(res.commit_sha).toBe("commit123");
    expect(res.content_sha).toBe("newsha");
    expect(res.html_url).toBe("https://github.com/x");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/contents/personal/raw/a.pdf");
    expect((init as RequestInit).method).toBe("PUT");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-pat" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ message: "add a.pdf", content: "Zm9v", branch: "main" });
    expect(body).not.toHaveProperty("sha");
    expect(body.committer).toMatchObject({ name: "wiki-mcp" });
  });

  it("putFile includes sha on update", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ content: { sha: "n", html_url: "u" }, commit: { sha: "c" } })),
    );
    const client = new GithubClient(makeEnv());
    await client.putFile("personal/raw/a.pdf", "Zm9v", "update", "oldsha");
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sha).toBe("oldsha");
  });

  it("putFile throws on 401 with helpful hint", async () => {
    fetchSpy.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const client = new GithubClient(makeEnv());
    await expect(client.putFile("personal/raw/a.pdf", "Zm9v", "m")).rejects.toThrow(
      /GitHub auth failed/,
    );
  });

  it("putFile throws on 409 (sha mismatch)", async () => {
    fetchSpy.mockResolvedValue(new Response("conflict", { status: 409 }));
    const client = new GithubClient(makeEnv());
    await expect(client.putFile("personal/raw/a.pdf", "Zm9v", "m", "stale")).rejects.toThrow(
      /conflict/i,
    );
  });

  it("putFile throws on 422 surfacing GitHub message", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: "path is invalid" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new GithubClient(makeEnv());
    await expect(client.putFile("bad//path", "Zm9v", "m")).rejects.toThrow(/path is invalid/);
  });
});
