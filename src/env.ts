export type Env = {
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  WIKI_SERVER_NAME: string;
  CACHE_TTL_SECONDS: string;
  SCHEMA_GLOBS: string;
  DOMAIN_REQUIRED_FILES: string;
  MCP_BEARER: string;
  MCP_BEARER_NEXT?: string;
  GITHUB_TOKEN: string;
};

export function parseCsv(value: string): string[] {
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

export function ttlMs(env: Env): number {
  const seconds = parseInt(env.CACHE_TTL_SECONDS, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return 60_000;
  return seconds * 1000;
}
