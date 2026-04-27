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
  WIKI_PRIME_VOCAB?: string;
  WIKI_PRIME_GREETING?: string;
  MAX_UPLOAD_BYTES?: string;
  RAW_FOLDER?: string;
};

const REQUIRED_KEYS = [
  "GITHUB_REPO",
  "GITHUB_BRANCH",
  "WIKI_SERVER_NAME",
  "CACHE_TTL_SECONDS",
  "SCHEMA_GLOBS",
  "DOMAIN_REQUIRED_FILES",
  "MCP_BEARER",
  "GITHUB_TOKEN",
] as const satisfies ReadonlyArray<keyof Env>;

export function assertEnv(env: Partial<Env>): asserts env is Env {
  const missing = REQUIRED_KEYS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `wiki-mcp misconfigured — missing required env vars/secrets: ${missing.join(", ")}. ` +
        `Set vars in wrangler.toml [vars] and secrets via 'wrangler secret put'.`,
    );
  }
}

export function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ttlMs(env: Env): number {
  const seconds = parseInt(env.CACHE_TTL_SECONDS, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return 60_000;
  return seconds * 1000;
}

import type { PrimeVocabMode } from "./types";

const VOCAB_MODES: readonly PrimeVocabMode[] = ["structural", "full", "off"];

export function parseVocabMode(raw: string | undefined): PrimeVocabMode {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "structural";
  return (VOCAB_MODES as readonly string[]).includes(trimmed)
    ? (trimmed as PrimeVocabMode)
    : "structural";
}

const DEFAULT_MAX_UPLOAD_BYTES = 26_214_400;
const DEFAULT_RAW_FOLDER = "raw";

export function maxUploadBytes(env: Partial<Env>): number {
  const n = parseInt(env.MAX_UPLOAD_BYTES ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return n;
}

export function rawFolder(env: Partial<Env>): string {
  const raw = (env.RAW_FOLDER ?? "").trim();
  if (!raw) return DEFAULT_RAW_FOLDER;
  if (raw.includes("/") || raw.includes("\\") || raw.includes("..")) return DEFAULT_RAW_FOLDER;
  return raw;
}
