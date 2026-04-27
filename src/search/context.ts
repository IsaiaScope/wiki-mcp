import type { Env } from "../env";
import { redactBody } from "../env";
import type { GithubClient } from "../github";
import { snapCache } from "../snapshot-cache";
import type { Bundle, Hit, Snapshot } from "../types";
import { basename, isAllDomain, pathToText, toStringArray } from "../util";
import { extractLinks, parseFrontmatter, resolveLink } from "../wiki";
import { estimateTokens, truncateAtHeading } from "./budget";
import { type RankDoc, rankDocs } from "./rank";

export type ContextInput = {
  question: string;
  domain: "all" | string;
  budget_tokens: number;
  include_log?: boolean;
};

const CITATION_INSTRUCTIONS =
  "Cite wiki pages with [[path]] (strip .md). Quote Italian phrases verbatim with an English gloss in square brackets on first mention.";
const EXPAND_CAP_PER_PAGE = 3;
const CANDIDATE_MULTIPLIER = 3;

export async function buildContext(
  input: ContextInput,
  snap: Snapshot,
  client: GithubClient,
  _env: Env,
): Promise<Bundle> {
  const candidatePaths = collectCandidatePaths(snap, input.domain);
  const metadataDocs = getMetaDocs(snap, input.domain, candidatePaths);

  const metaHits = rankDocs(input.question, metadataDocs);
  const candidateK = Math.max(5, Math.ceil(input.budget_tokens / 400));
  const topMeta = metaHits.slice(0, candidateK * CANDIDATE_MULTIPLIER);
  const topPaths =
    topMeta.length > 0 ? topMeta.map((h) => h.id) : candidatePaths.slice(0, candidateK);

  const bodies = await Promise.all(
    topPaths.map(async (p) => ({ path: p, raw: await safeFetch(client, snap.sha, p) })),
  );

  const bodyDocs: RankDoc[] = bodies.map((b) => pageRankDoc(b.path, b.raw));
  const bodyHits = rankDocs(input.question, bodyDocs);
  const chosen = (bodyHits.length > 0 ? bodyHits : metaHits).slice(0, candidateK).map((h) => h.id);

  const bodyByPath = new Map(bodies.map((b) => [b.path, b.raw]));

  const chosenSet = new Set(chosen);
  const expansionPlan: Array<{ path: string; parent: string }> = [];
  const planned = new Set<string>();
  for (const parentPath of chosen) {
    const parentBody = bodyByPath.get(parentPath) ?? "";
    const linked = extractLinks(parentBody);
    const resolved = linked
      .map((l) => resolveLink(l, parentPath, snap.allPaths))
      .filter((x): x is string => !!x)
      .filter((p) => !chosenSet.has(p) && !planned.has(p))
      .slice(0, EXPAND_CAP_PER_PAGE);
    for (const p of resolved) {
      planned.add(p);
      expansionPlan.push({ path: p, parent: parentPath });
    }
  }
  // Batch expansion fetches: planned paths are independent, body LRU dedupes.
  const expansionBodies = await Promise.all(
    expansionPlan.map((e) => safeFetch(client, snap.sha, e.path)),
  );
  const expansions = new Map<string, { body: string; parent: string }>();
  for (let i = 0; i < expansionPlan.length; i++) {
    const raw = expansionBodies[i];
    if (raw) expansions.set(expansionPlan[i].path, { body: raw, parent: expansionPlan[i].parent });
  }

  const hits: Hit[] = [];
  let remaining = input.budget_tokens;

  for (const path of chosen) {
    if (remaining <= 0) break;
    const rawBody = redactBody(bodyByPath.get(path) ?? "");
    const trunc = truncateAtHeading(rawBody, remaining, { path });
    const expandedPaths = [...expansions.entries()]
      .filter(([, v]) => v.parent === path)
      .map(([k]) => k);
    hits.push({
      path,
      score: bodyHits.find((h) => h.id === path)?.score ?? 0,
      reason: "direct match",
      body: trunc.text,
      truncated: trunc.truncated,
      links_expanded: expandedPaths,
    });
    remaining -= estimateTokens(trunc.text);
  }

  if (remaining > 0) {
    const sortedExpansions = [...expansions.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [path, entry] of sortedExpansions) {
      if (remaining <= 0) break;
      const trunc = truncateAtHeading(redactBody(entry.body), remaining, { path });
      const parentHit = hits.find((h) => h.path === entry.parent);
      if (parentHit && !parentHit.links_expanded.includes(path)) {
        parentHit.links_expanded.push(path);
      }
      hits.push({
        path,
        score: 0,
        reason: `expansion from ${entry.parent}`,
        body: trunc.text,
        truncated: trunc.truncated,
        links_expanded: [],
      });
      remaining -= estimateTokens(trunc.text);
    }
  }

  // Three independent reads — fan out to overlap I/O.
  const [indexes, schema, recent_log] = await Promise.all([
    readIndexes(snap, client, input.domain),
    readSchema(snap, client),
    input.include_log === false
      ? Promise.resolve<string[]>([])
      : readRecentLog(snap, client, input.domain),
  ]);

  return {
    schema,
    indexes,
    recent_log,
    hits,
    citation_instructions: CITATION_INSTRUCTIONS,
  };
}

async function safeFetch(client: GithubClient, sha: string, path: string): Promise<string> {
  try {
    return await client.fetchBody(sha, path);
  } catch {
    return "";
  }
}

function domainMatches(filter: string, name: string): boolean {
  return isAllDomain(filter) || filter.toLowerCase() === name.toLowerCase();
}

function collectCandidatePaths(snap: Snapshot, domainFilter: string): string[] {
  const out: string[] = [];
  for (const [name, dom] of snap.domains) {
    if (!domainMatches(domainFilter, name)) continue;
    for (const [, paths] of dom.wikiTypes) out.push(...paths);
  }
  return out;
}

export function pageRankDoc(path: string, raw: string): RankDoc {
  if (!raw) return { id: path, text: pathToText(path), weightedTerms: [basename(path)] };
  const parsed = parseFrontmatter(raw, { pathHint: path });
  return {
    id: path,
    text: `${parsed.title} ${parsed.body}`,
    weightedTerms: [
      parsed.title,
      ...toStringArray(parsed.data.aliases),
      ...toStringArray(parsed.data.tags),
      ...toStringArray(parsed.data.entities),
      ...toStringArray(parsed.data.concepts),
      ...parsed.headings,
    ],
  };
}

function getMetaDocs(snap: Snapshot, domainFilter: string, candidatePaths: string[]): RankDoc[] {
  const cache = snapCache(snap);
  const cacheKey = domainFilter;
  if (!cache.metaDocs) cache.metaDocs = new Map();
  const hit = cache.metaDocs.get(cacheKey);
  if (hit) return hit;
  const built: RankDoc[] = candidatePaths.map((p) => ({
    id: p,
    text: pathToText(p),
    weightedTerms: [basename(p)],
  }));
  cache.metaDocs.set(cacheKey, built);
  return built;
}

async function readIndexes(
  snap: Snapshot,
  client: GithubClient,
  domainFilter: string,
): Promise<Record<string, string>> {
  const cache = snapCache(snap);
  if (!cache.indexes) cache.indexes = new Map();
  const hit = cache.indexes.get(domainFilter);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const [name, dom] of snap.domains) {
    if (!domainMatches(domainFilter, name)) continue;
    out[name] = await safeFetch(client, snap.sha, dom.indexPath);
  }
  cache.indexes.set(domainFilter, out);
  return out;
}

async function readSchema(snap: Snapshot, client: GithubClient): Promise<string> {
  const cache = snapCache(snap);
  if (cache.schema !== undefined) return cache.schema;
  const parts: string[] = [];
  for (const p of snap.schemaPaths) {
    const body = await safeFetch(client, snap.sha, p);
    if (body) parts.push(`\n\n--- ${p} ---\n\n${body}`);
  }
  const result = parts.join("\n").trim();
  cache.schema = result;
  return result;
}

async function readRecentLog(
  snap: Snapshot,
  client: GithubClient,
  domainFilter: string,
): Promise<string[]> {
  const all: Array<{ line: string; date: string }> = [];
  for (const [name, dom] of snap.domains) {
    if (!domainMatches(domainFilter, name)) continue;
    const body = await safeFetch(client, snap.sha, dom.logPath);
    for (const line of body.split("\n")) {
      const m = line.match(/^##\s+\[([0-9T:\-Z]+)\]/);
      if (m) all.push({ line: line.trim(), date: m[1] });
    }
  }
  return all
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50)
    .map((e) => e.line);
}
