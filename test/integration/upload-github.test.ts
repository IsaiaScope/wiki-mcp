import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubClient } from "../../src/github";
import type { Snapshot } from "../../src/types";
import { uploadFile } from "../../src/upload";
import { makeEnv } from "../helpers";

function makeSnapshot(names: string[]): Snapshot {
  const domains = new Map(
    names.map((n) => [
      n,
      {
        name: n,
        indexPath: `${n}/index.md`,
        logPath: `${n}/log.md`,
        wikiTypes: new Map<string, string[]>(),
        rawPaths: [],
      },
    ]),
  );
  return {
    sha: "snap",
    fetchedAt: Date.now(),
    domains,
    allPaths: [],
    schemaPaths: [],
  };
}

describe("uploadFile end-to-end (stubbed fetch)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  it("creates a new file: GET 404 then PUT without sha", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: { sha: "newsha", html_url: "https://example/x" },
            commit: { sha: "c1" },
          }),
        ),
      );
    const env = makeEnv();
    const gh = new GithubClient(env);
    const res = await uploadFile(
      {
        domain: "personal",
        subpath: "docs/a.pdf",
        content_base64: Buffer.from("hello").toString("base64"),
      },
      makeSnapshot(["personal"]),
      gh,
      env,
    );

    expect(res.path).toBe("personal/raw/docs/a.pdf");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, putInit] = fetchSpy.mock.calls[1];
    expect((putInit as RequestInit).method).toBe("PUT");
    expect(JSON.parse((putInit as RequestInit).body as string)).not.toHaveProperty("sha");
  });

  it("updates an existing file: GET returns sha then PUT includes it", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: "existing" }), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: { sha: "new", html_url: "u" },
            commit: { sha: "c" },
          }),
        ),
      );
    const env = makeEnv();
    const gh = new GithubClient(env);
    await uploadFile(
      {
        domain: "personal",
        subpath: "docs/a.pdf",
        content_base64: Buffer.from("x").toString("base64"),
      },
      makeSnapshot(["personal"]),
      gh,
      env,
    );
    const [, putInit] = fetchSpy.mock.calls[1];
    expect(JSON.parse((putInit as RequestInit).body as string).sha).toBe("existing");
  });

  it("propagates 401 auth errors with hint", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const env = makeEnv();
    const gh = new GithubClient(env);
    await expect(
      uploadFile(
        { domain: "personal", subpath: "a.pdf", content_base64: "AAAA" },
        makeSnapshot(["personal"]),
        gh,
        env,
      ),
    ).rejects.toThrow(/GitHub auth failed/);
  });

  it("writes to the configured branch", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: { sha: "s", html_url: "u" },
            commit: { sha: "c" },
          }),
        ),
      );
    const env = makeEnv({ GITHUB_BRANCH: "wiki" });
    const gh = new GithubClient(env);
    await uploadFile(
      { domain: "personal", subpath: "a.pdf", content_base64: "AAAA" },
      makeSnapshot(["personal"]),
      gh,
      env,
    );
    const [, putInit] = fetchSpy.mock.calls[1];
    expect(JSON.parse((putInit as RequestInit).body as string).branch).toBe("wiki");
  });
});
