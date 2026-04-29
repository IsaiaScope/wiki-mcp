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
  expand_links?: boolean;
};

const CITATION_INSTRUCTIONS =
  "Cite wiki pages with [[path]] (strip .md). Quote Italian phrases verbatim with an English gloss in square brackets on first mention.";
const EXPAND_CAP_PER_PAGE = 3;
const CANDIDATE_MULTIPLIER = 3;

export async function buildContext(
  input: ContextInput,
  snap: Snapshot,
  client: GithubClient,
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

  const expansions = new Map<string, { body: string; parent: string }>();

  if (input.expand_links) {
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
    for (let i = 0; i < expansionPlan.length; i++) {
      const raw = expansionBodies[i];
      if (raw)
        expansions.set(expansionPlan[i].path, { body: raw, parent: expansionPlan[i].parent });
    }
  }

  const hits: Hit[] = [];
  let remaining = input.budget_tokens;

  for (const path of chosen) {
    if (remaining <= 0) break;
    const rawBody = redactBody(bodyByPath.get(path) ?? "");
    const trunc = truncateAtHeading(rawBody, remaining, { path });
    hits.push({
      path,
      score: bodyHits.find((h) => h.id === path)?.score ?? 0,
      body: trunc.text,
      truncated: trunc.truncated,
    });
    remaining -= estimateTokens(trunc.text);
  }

  if (input.expand_links && remaining > 0) {
    const sortedExpansions = [...expansions.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [path, entry] of sortedExpansions) {
      if (remaining <= 0) break;
      const trunc = truncateAtHeading(redactBody(entry.body), remaining, { path });
      hits.push({
        path,
        score: 0,
        body: trunc.text,
        truncated: trunc.truncated,
        viaParent: entry.parent,
      });
      remaining -= estimateTokens(trunc.text);
    }
  }

  return {
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
