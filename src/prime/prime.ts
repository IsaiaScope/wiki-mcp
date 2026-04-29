import type { Env } from "../env";
import { parseVocabMode } from "../env";
import type { Domain, PrimeBundle, PrimeVocabMode, Snapshot, ToolName } from "../types";

const KNOWN_ACRONYMS = new Set(["CCNL", "TFR", "ID", "URL", "API", "MCP", "LLM"]);

export function prettifyTitle(raw: string): string {
  if (!raw) return "";
  const stripped = raw.replace(/\.md$/i, "");

  // Handle ISO date patterns (YYYY-MM-DD) specially to preserve hyphens
  const dateMatch = stripped.match(/^(\d{4}-\d{2}-\d{2})-(.*)$/);
  let datePart = "";
  let remaining = stripped;

  if (dateMatch) {
    datePart = dateMatch[1];
    remaining = dateMatch[2];
  }

  const parts = remaining.split(/[-_\s]+/).filter(Boolean);
  const processedParts = parts.map((part) => {
    const up = part.toUpperCase();
    if (KNOWN_ACRONYMS.has(up)) return up;
    if (/^\d/.test(part)) return part; // keep date/number runs verbatim
    if (/[A-Z]/.test(part)) return part; // preserve existing cased words
    return part.charAt(0).toUpperCase() + part.slice(1);
  });

  const result = processedParts.join(" ");
  return datePart ? `${datePart} ${result}` : result;
}

const STATIC_TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  wiki_context:
    "PRIMARY tool for natural-language wiki questions. Returns one bundle: schema (CLAUDE.md + llm-wiki conventions) + per-domain indexes + last 50 log entries + ranked page hits with bodies + one-hop wikilink expansions. Hits include `truncated: boolean` when bodies are clipped to fit budget_tokens — call wiki_fetch for the full page. Use this when you don't know exact paths. Cite hits with [[path]]. Pass include_log=false to skip activity log for privacy. Domain filter accepts a domain name or 'all' (default).",
  wiki_search:
    "Keyword search with two-stage rank: path-token shortlist, then body+frontmatter re-rank (title, aliases, tags, entities, concepts, headings). Returns {path,title,snippet,score}. Cost note: `limit` controls returned hits; stage 2 fetches up to limit*2 bodies. Frontmatter filters (tag/entity/concept) match case-insensitively. Use when you have an exact term or phrase (quoted phrases supported). Chain with wiki_fetch to read full bodies.",
  wiki_fetch:
    "Read full markdown for known paths (max 20 per call). Returns {path,content,frontmatter}. Partial-success: unknown paths return a per-path `error` field rather than failing the whole batch — inspect each result. Frontmatter is filtered by SENSITIVE_FRONTMATTER_KEYS. Use after wiki_search/wiki_list/citations surface a path.",
  wiki_list:
    "Enumerate discovered pages without fetching bodies. Optional filters: domain, type, tag, entity, concept (all case-insensitive). Pagination: `limit` (default 200, max 1000) and `offset`. Returns {items, total, offset, limit, truncated}. Cheapest tool — use to scope before wiki_context.",
  wiki_upload:
    "Upload a file to {domain}/raw/{subpath}. base64 content, 25 MB cap. Stored as-is, no transformation.",
  wiki_read_raw:
    "Read a raw file (binary or text) at {domain}/raw/{subpath} as base64. Use after wiki_list surfaces a raw path.",
};

function appendDomainHint(desc: string, snapshot: Snapshot): string {
  const domains = [...snapshot.domains.keys()];
  if (domains.length === 0) return desc;
  return `${desc} Domains: [${domains.join(", ")}].`;
}

function buildUploadDescription(snapshot: Snapshot): string {
  const base = STATIC_TOOL_DESCRIPTIONS.wiki_upload;
  const domains = [...snapshot.domains.keys()];
  if (domains.length === 0) return `${base} (No domains discovered yet.)`;
  return `${base} Valid domains: [${domains.join(", ")}].`;
}

export function buildPrime(snapshot: Snapshot, env: Env): PrimeBundle {
  const vocabMode = parseVocabMode(env.WIKI_PRIME_VOCAB);
  const greeting = (env.WIKI_PRIME_GREETING ?? "").trim();
  const vocab = collectVocab(snapshot);

  return {
    vocabMode,
    sha: snapshot.sha,
    instructions: buildInstructions(snapshot, vocab, env, vocabMode, greeting),
    toolDescriptions: buildToolDescriptions(vocab, vocabMode, snapshot),
    overviewIndex: buildOverviewIndex(snapshot, env, greeting, vocabMode),
    overviewByDomain: buildOverviewByDomain(snapshot, vocabMode),
  };
}

type Vocab = Map<string, Map<string, string[]>>; // domain → type → prettified titles

function collectVocab(snapshot: Snapshot): Vocab {
  const out: Vocab = new Map();
  for (const [name, dom] of snapshot.domains) {
    const perType = new Map<string, string[]>();
    for (const [t, paths] of dom.wikiTypes) {
      const titles: string[] = [];
      for (const p of paths) {
        const base = p.split("/").pop() ?? p;
        const pretty = prettifyTitle(base);
        if (pretty) titles.push(pretty);
      }
      perType.set(t, titles);
    }
    out.set(name, perType);
  }
  return out;
}

function countDomainPages(dom: Domain): number {
  let total = 0;
  for (const paths of dom.wikiTypes.values()) total += paths.length;
  return total;
}

const INSTRUCTIONS_TITLE_CAP = 20;

function flatTriggerList(vocab: Vocab, cap: number): { included: string[]; omitted: number } {
  const all = new Set<string>();
  for (const perType of vocab.values()) {
    for (const titles of perType.values()) {
      for (const t of titles) all.add(t);
    }
  }
  const sorted = Array.from(all).sort((a, b) => a.localeCompare(b));
  return {
    included: sorted.slice(0, cap),
    omitted: Math.max(0, sorted.length - cap),
  };
}

function buildInstructions(
  snapshot: Snapshot,
  vocab: Vocab,
  env: Env,
  mode: PrimeVocabMode,
  greeting: string,
): string {
  const name = env.WIKI_SERVER_NAME;

  if (mode === "off") {
    const parts: string[] = [];
    if (greeting) parts.push(greeting);
    parts.push(
      `Personal knowledge wiki for ${name}. Call wiki_context for wiki-relevant questions; read wiki://overview for inventory.`,
    );
    return parts.join("\n\n");
  }

  const parts: string[] = [];
  if (greeting) parts.push(greeting);
  parts.push(`Personal knowledge wiki for ${name}.`);

  if (snapshot.domains.size === 0) {
    parts.push(
      "There are no wiki domains discovered yet. Configure DOMAIN_REQUIRED_FILES (currently requires the listed files at a top-level folder) to match your tree, or populate a domain folder. Read wiki://overview for the current discovery contract.",
    );
  } else {
    parts.push("Domains discovered:");
    for (const [dname, dom] of snapshot.domains) {
      const count = countDomainPages(dom);
      if (count === 0) {
        parts.push(`- ${dname}: (empty)`);
        continue;
      }
      const typeSummary = Array.from(dom.wikiTypes.entries())
        .map(([t, ps]) => `${t} (${ps.length})`)
        .join(", ");
      parts.push(`- ${dname}: ${count} pages — ${typeSummary}`);
    }
    parts.push(
      "Call wiki_context before answering questions that may involve this wiki. Cite with [[path]]. Read wiki://overview for the full page inventory. Never invent sources or pages not present in the wiki.",
    );

    if (mode === "full") {
      const { included, omitted } = flatTriggerList(vocab, INSTRUCTIONS_TITLE_CAP);
      if (included.length > 0) {
        const suffix = omitted > 0 ? ` and ${omitted} more` : "";
        parts.push(`Trigger vocabulary: ${included.join(", ")}${suffix}.`);
      }
    }
  }

  return parts.join("\n\n");
}

function buildToolDescriptions(
  _vocab: Vocab,
  mode: PrimeVocabMode,
  snapshot: Snapshot,
): Record<ToolName, string> {
  const uploadDesc = buildUploadDescription(snapshot);
  if (mode === "off") return { ...STATIC_TOOL_DESCRIPTIONS, wiki_upload: uploadDesc };

  const baseTail =
    " Read wiki://overview for the current page inventory before deciding between wiki_context, wiki_search, and wiki_fetch.";

  const contextDesc = STATIC_TOOL_DESCRIPTIONS.wiki_context + baseTail;

  return {
    wiki_context: appendDomainHint(contextDesc, snapshot),
    wiki_search: appendDomainHint(STATIC_TOOL_DESCRIPTIONS.wiki_search, snapshot),
    wiki_fetch: appendDomainHint(STATIC_TOOL_DESCRIPTIONS.wiki_fetch, snapshot),
    wiki_list: appendDomainHint(STATIC_TOOL_DESCRIPTIONS.wiki_list, snapshot),
    wiki_upload: uploadDesc,
    wiki_read_raw: appendDomainHint(STATIC_TOOL_DESCRIPTIONS.wiki_read_raw, snapshot),
  };
}

function buildOverviewIndex(
  snapshot: Snapshot,
  env: Env,
  greeting: string,
  mode: PrimeVocabMode,
): string {
  const lines: string[] = [];
  lines.push(`# ${env.WIKI_SERVER_NAME} — Wiki Overview`);
  if (greeting) {
    lines.push("");
    lines.push(greeting);
  }
  lines.push("");

  if (mode === "off") {
    lines.push(
      "Vocabulary suppressed by WIKI_PRIME_VOCAB=off. Use wiki_list for an enumerated page listing.",
    );
    return lines.join("\n");
  }

  if (snapshot.domains.size === 0) {
    lines.push(
      "No wiki domains discovered. See DOMAIN_REQUIRED_FILES / SCHEMA_GLOBS in wrangler.toml.",
    );
    return lines.join("\n");
  }

  lines.push(`Available domains: ${Array.from(snapshot.domains.keys()).join(", ")}`);
  lines.push("");
  lines.push("Per-domain slices:");
  for (const [dname, dom] of snapshot.domains) {
    lines.push(`- wiki://overview/${dname} (${countDomainPages(dom)} pages)`);
  }
  return lines.join("\n");
}

function buildOverviewByDomain(snapshot: Snapshot, mode: PrimeVocabMode): Map<string, string> {
  const out = new Map<string, string>();
  for (const [dname, dom] of snapshot.domains) {
    if (mode === "off") {
      out.set(dname, `# ${dname}\n\nVocabulary suppressed by WIKI_PRIME_VOCAB=off.`);
      continue;
    }
    const lines: string[] = [];
    lines.push(`# ${dname}`);
    if (countDomainPages(dom) === 0) {
      lines.push("");
      lines.push("_(empty — no pages yet)_");
      out.set(dname, lines.join("\n"));
      continue;
    }
    for (const [t, paths] of dom.wikiTypes) {
      lines.push("");
      lines.push(`## ${t} (${paths.length})`);
      for (const p of paths) {
        lines.push(`- ${p}`);
      }
    }
    out.set(dname, lines.join("\n"));
  }
  return out;
}
