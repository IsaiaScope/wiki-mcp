import type { Env } from "./env";
import { ttlMs } from "./env";
import type { GithubTreeEntry } from "./types";

export type TreeResponse = {
  sha: string;
  truncated: boolean;
  tree: GithubTreeEntry[];
};

type CacheEntry = { value: TreeResponse; at: number };

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

  invalidate(): void {
    this.cache = null;
  }
}
