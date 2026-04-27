import type { Env } from "./env";
import { ttlMs } from "./env";
import type { GithubTreeEntry } from "./types";

export type TreeResponse = {
  sha: string;
  truncated: boolean;
  tree: GithubTreeEntry[];
};

type CacheEntry = { value: TreeResponse; at: number };

export type PutFileResult = {
  content_sha: string;
  commit_sha: string;
  html_url: string;
};

export class GithubClient {
  private cache: CacheEntry | null = null;

  constructor(private env: Env) {}

  async fetchTree(): Promise<TreeResponse> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < ttlMs(this.env)) {
      return this.cache.value;
    }
    const [owner, repo] = this.env.GITHUB_REPO.split("/");
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${this.env.GITHUB_BRANCH}?recursive=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "wiki-mcp",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub tree fetch failed: ${res.status} ${res.statusText}`);
    }
    const value = (await res.json()) as TreeResponse;
    this.cache = { value, at: now };
    return value;
  }

  rawUrl(sha: string, path: string): string {
    const [owner, repo] = this.env.GITHUB_REPO.split("/");
    const encoded = path
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${encoded}`;
  }

  async fetchBody(sha: string, path: string): Promise<string> {
    const res = await fetch(this.rawUrl(sha, path), {
      headers: { "User-Agent": "wiki-mcp" },
    });
    if (!res.ok) {
      throw new Error(`Raw fetch failed for ${path}: ${res.status}`);
    }
    return await res.text();
  }

  private contentsUrl(path: string): string {
    const [owner, repo] = this.env.GITHUB_REPO.split("/");
    const encoded = path
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}`;
  }

  async fetchFileSha(path: string): Promise<string | null> {
    const url = `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.env.GITHUB_BRANCH)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "wiki-mcp",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`GitHub contents GET failed for ${path}: ${res.status}`);
    }
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  }

  async putFile(
    path: string,
    contentBase64: string,
    message: string,
    sha?: string,
  ): Promise<PutFileResult> {
    const url = this.contentsUrl(path);
    const body: Record<string, unknown> = {
      message,
      content: contentBase64,
      branch: this.env.GITHUB_BRANCH,
      committer: {
        name: "wiki-mcp",
        email: "wiki-mcp@users.noreply.github.com",
      },
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "wiki-mcp",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`GitHub auth failed (${res.status}) — check GITHUB_TOKEN has contents:write`);
    }
    if (res.status === 409) {
      throw new Error("GitHub conflict (409) — file changed concurrently. Retry.");
    }
    if (res.status === 422) {
      let detail = "";
      try {
        const j = (await res.json()) as { message?: string };
        detail = j.message ?? "";
      } catch {
        /* swallow */
      }
      throw new Error(`GitHub rejected path (422): ${detail}`);
    }
    if (!res.ok) {
      throw new Error(`GitHub PUT failed (${res.status}) for ${path}`);
    }

    const json = (await res.json()) as {
      content?: { sha?: string; html_url?: string };
      commit?: { sha?: string };
    };
    return {
      content_sha: json.content?.sha ?? "",
      commit_sha: json.commit?.sha ?? "",
      html_url: json.content?.html_url ?? "",
    };
  }

  invalidate(): void {
    this.cache = null;
  }

  isStale(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.at >= ttlMs(this.env);
  }
}
