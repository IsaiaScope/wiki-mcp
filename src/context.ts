import type { Env } from "./env";
import type { Snapshot, Bundle, Hit } from "./types";
import { GithubClient } from "./github";
import { parseFrontmatter } from "./frontmatter";
import { rankDocs, type RankDoc } from "./rank";
import { extractLinks, resolveLink } from "./wikilinks";
import { estimateTokens, truncateAtHeading } from "./budget";

export type ContextInput = {
  question: string;
  domain: "all" | string;
  budget_tokens: number;
};

const CITATION_INSTRUCTIONS =
  "Cite wiki pages with [[path]] (strip .md). Quote Italian phrases verbatim with an English gloss in square brackets on first mention.";
const EXPAND_CAP_PER_PAGE = 3;
const CANDIDATE_MULTIPLIER = 2;

export async function buildContext(
  input: ContextInput,
  snap: Snapshot,
  client: GithubClient,
  env: Env
): Promise<Bundle> {
  const candidatePaths = collectCandidatePaths(snap, input.domain);

  const metadataDocs: RankDoc[] = candidatePaths.map(p => ({
    id: p,
    text: pathToText(p),
    weightedTerms: [basename(p)]
  }));

  const metaHits = rankDocs(input.question, metadataDocs);
  const candidateK = Math.max(5, Math.ceil(input.budget_tokens / 400));
  const topMeta = metaHits.slice(0, candidateK * CANDIDATE_MULTIPLIER);
  const topPaths = topMeta.length > 0
    ? topMeta.map(h => h.id)
    : candidatePaths.slice(0, candidateK);

  const bodies = await Promise.all(
    topPaths.map(async p => ({ path: p, raw: await safeFetch(client, snap.sha, p) }))
  );

  const bodyDocs: RankDoc[] = bodies.map(b => {
    const parsed = parseFrontmatter(b.raw, { pathHint: b.path });
    const tagTerms = extractStringArray(parsed.data.tags);
    const entityTerms = extractStringArray(parsed.data.entities);
    const conceptTerms = extractStringArray(parsed.data.concepts);
    return {
      id: b.path,
      text: `${parsed.title} ${parsed.body}`,
      weightedTerms: [parsed.title, ...tagTerms, ...entityTerms, ...conceptTerms, ...parsed.headings]
    };
  });
  const bodyHits = rankDocs(input.question, bodyDocs);
  const chosen = (bodyHits.length > 0 ? bodyHits : metaHits)
    .slice(0, candidateK)
    .map(h => h.id);

  const bodyByPath = new Map(bodies.map(b => [b.path, b.raw]));

  const expansions = new Map<string, { body: string; parent: string }>();
  for (const parentPath of chosen) {
    const parentBody = bodyByPath.get(parentPath) ?? "";
    const linked = extractLinks(parentBody);
    const resolved = linked
      .map(l => resolveLink(l, parentPath, snap.allPaths))
      .filter((x): x is string => !!x)
      .filter(p => !chosen.includes(p) && !expansions.has(p))
      .slice(0, EXPAND_CAP_PER_PAGE);

    for (const p of resolved) {
      const raw = await safeFetch(client, snap.sha, p);
      if (raw) expansions.set(p, { body: raw, parent: parentPath });
    }
  }

  const hits: Hit[] = [];
  let remaining = input.budget_tokens;

  for (const path of chosen) {
    const rawBody = bodyByPath.get(path) ?? "";
    const trunc = truncateAtHeading(rawBody, Math.max(remaining, 0), { path });
    const expandedPaths = [...expansions.entries()]
      .filter(([, v]) => v.parent === path)
      .map(([k]) => k);
    hits.push({
      path,
      score: bodyHits.find(h => h.id === path)?.score ?? 0,
      reason: "direct match",
      body: trunc.text,
      links_expanded: expandedPaths
    });
    remaining -= estimateTokens(trunc.text);
    if (remaining <= 0) break;
  }

  if (remaining > 0) {
    const sortedExpansions = [...expansions.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [path, entry] of sortedExpansions) {
      if (remaining <= 0) break;
      const trunc = truncateAtHeading(entry.body, remaining, { path });
      const parentHit = hits.find(h => h.path === entry.parent);
      if (parentHit && !parentHit.links_expanded.includes(path)) {
        parentHit.links_expanded.push(path);
      }
      hits.push({
        path,
        score: 0,
        reason: `expansion from ${entry.parent}`,
        body: trunc.text,
        links_expanded: []
      });
      remaining -= estimateTokens(trunc.text);
    }
  }

  const indexes = await readIndexes(snap, client, input.domain);
  const schema = await readSchema(snap, client);
  const recent_log = await readRecentLog(snap, client, input.domain);

  return {
    schema,
    indexes,
    recent_log,
    hits,
    citation_instructions: CITATION_INSTRUCTIONS
  };
}

async function safeFetch(client: GithubClient, sha: string, path: string): Promise<string> {
  try {
    return await client.fetchBody(sha, path);
  } catch {
    return "";
  }
}

function collectCandidatePaths(snap: Snapshot, domainFilter: string): string[] {
  const out: string[] = [];
  for (const [name, dom] of snap.domains) {
    if (domainFilter !== "all" && domainFilter !== name) continue;
    for (const [, paths] of dom.wikiTypes) out.push(...paths);
  }
  return out;
}

function pathToText(path: string): string {
  return path.replace(/\.md$/, "").replace(/[\/_-]/g, " ");
}

function basename(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(v => typeof v === "string");
}

async function readIndexes(snap: Snapshot, client: GithubClient, domainFilter: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, dom] of snap.domains) {
    if (domainFilter !== "all" && domainFilter !== name) continue;
    out[name] = await safeFetch(client, snap.sha, dom.indexPath);
  }
  return out;
}

async function readSchema(snap: Snapshot, client: GithubClient): Promise<string> {
  const parts: string[] = [];
  for (const p of snap.schemaPaths) {
    const body = await safeFetch(client, snap.sha, p);
    if (body) parts.push(`\n\n--- ${p} ---\n\n` + body);
  }
  return parts.join("\n").trim();
}

async function readRecentLog(snap: Snapshot, client: GithubClient, domainFilter: string): Promise<string[]> {
  const all: Array<{ line: string; date: string }> = [];
  for (const [name, dom] of snap.domains) {
    if (domainFilter !== "all" && domainFilter !== name) continue;
    const body = await safeFetch(client, snap.sha, dom.logPath);
    for (const line of body.split("\n")) {
      const m = line.match(/^##\s+\[([0-9T:\-Z]+)\]/);
      if (m) all.push({ line: line.trim(), date: m[1] });
    }
  }
  return all
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50)
    .map(e => e.line);
}
