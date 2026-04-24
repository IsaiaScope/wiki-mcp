import type { Env } from "./env";
import { parseCsv } from "./env";
import type { TreeResponse } from "./github";
import type { Snapshot, Domain } from "./types";

const SKIP_TOP_DIRS = new Set([".git", ".github", "docs", "mcp", "node_modules", ".obsidian", ".trash"]);

export function buildSnapshot(tree: TreeResponse, env: Env): Snapshot {
  const requiredFiles = parseCsv(env.DOMAIN_REQUIRED_FILES);
  const schemaGlobs = parseCsv(env.SCHEMA_GLOBS);

  const allPaths = tree.tree
    .filter(e => e.type === "blob")
    .map(e => e.path);

  const topDirs = collectTopDirs(allPaths);
  const domains = new Map<string, Domain>();

  for (const dir of topDirs) {
    if (SKIP_TOP_DIRS.has(dir) || dir.startsWith(".")) continue;
    if (!hasRequiredFiles(dir, requiredFiles, allPaths)) continue;
    if (!allPaths.some(p => p.startsWith(`${dir}/wiki/`))) continue;

    domains.set(dir, buildDomain(dir, allPaths));
  }

  const schemaPaths = allPaths.filter(p => matchesAnyGlob(p, schemaGlobs));

  return {
    sha: tree.sha,
    fetchedAt: Date.now(),
    domains,
    allPaths,
    schemaPaths
  };
}

function collectTopDirs(paths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const top = p.split("/")[0];
    if (top) out.add(top);
  }
  return out;
}

function hasRequiredFiles(dir: string, required: string[], all: string[]): boolean {
  return required.every(f => all.includes(`${dir}/${f}`));
}

function buildDomain(name: string, all: string[]): Domain {
  const wikiPrefix = `${name}/wiki/`;
  const wikiTypes = new Map<string, string[]>();
  const rawPaths: string[] = [];

  for (const p of all) {
    if (!p.startsWith(`${name}/`)) continue;
    if (p.startsWith(`${name}/raw/`)) {
      rawPaths.push(p);
      continue;
    }
    if (p.startsWith(wikiPrefix)) {
      const rest = p.slice(wikiPrefix.length);
      const type = rest.split("/")[0];
      if (!type || !rest.includes("/")) continue;
      const list = wikiTypes.get(type) ?? [];
      list.push(p);
      wikiTypes.set(type, list);
    }
  }

  const claudeMdPath = all.includes(`${name}/CLAUDE.md`)
    ? `${name}/CLAUDE.md`
    : undefined;

  return {
    name,
    indexPath: `${name}/index.md`,
    logPath: `${name}/log.md`,
    claudeMdPath,
    wikiTypes,
    rawPaths
  };
}

function matchesAnyGlob(path: string, globs: string[]): boolean {
  return globs.some(g => matchGlob(path, g));
}

function matchGlob(path: string, glob: string): boolean {
  const re = new RegExp(
    "^" +
      glob
        .split("/")
        .map(seg => seg === "*" ? "[^/]+" : escapeRegex(seg).replace(/\\\*/g, "[^/]*"))
        .join("/") +
      "$"
  );
  return re.test(path);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|\[\]\\]/g, "\\$&");
}
