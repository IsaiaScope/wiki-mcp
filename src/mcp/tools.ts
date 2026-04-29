import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Env, filterFrontmatter, redactBody, sensitiveFrontmatterKeys } from "../env";
import type { GithubClient } from "../github";
import { readRawFile } from "../raw";
import { buildContext, pageRankDoc, rankDocs } from "../search";
import { knownPathsOf } from "../snapshot-cache";
import type { FetchRow, ListGrouped, PrimeBundle, SearchRow, Snapshot } from "../types";
import { uploadFile } from "../upload";
import {
  arrayIncludesIgnoreCase,
  eqIgnoreCase,
  isAllDomain,
  pathToText,
  toStringArray,
} from "../util";
import { parseFrontmatter } from "../wiki";
import {
  renderContextMarkdown,
  renderFetchJSON,
  renderListJSON,
  renderSearchJSON,
} from "./serialize";

export type ToolContext = {
  env: Env;
  github: GithubClient;
  getSnapshot: () => Promise<Snapshot>;
  getPrime: () => Promise<PrimeBundle>;
  prime: PrimeBundle;
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function registerTools(server: McpServer, ctx: ToolContext) {
  const table = new Map<string, (args: unknown) => Promise<ToolResult>>();

  server.registerTool(
    "wiki_context",
    {
      description: ctx.prime.toolDescriptions.wiki_context,
      inputSchema: {
        question: z.string(),
        domain: z.string().optional(),
        budget_tokens: z.number().int().positive().max(12000).optional(),
        expand_links: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => wikiContextHandler(args, ctx),
  );
  table.set("wiki_context", (raw) => wikiContextHandler(raw, ctx));

  server.registerTool(
    "wiki_search",
    {
      description: ctx.prime.toolDescriptions.wiki_search,
      inputSchema: {
        query: z.string(),
        domain: z.string().optional(),
        limit: z.number().int().positive().max(50).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => wikiSearchHandler(args, ctx),
  );
  table.set("wiki_search", (raw) => wikiSearchHandler(raw, ctx));

  server.registerTool(
    "wiki_fetch",
    {
      description: ctx.prime.toolDescriptions.wiki_fetch,
      inputSchema: {
        paths: z.array(z.string()).min(1).max(20),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => wikiFetchHandler(args, ctx),
  );
  table.set("wiki_fetch", (raw) => wikiFetchHandler(raw, ctx));

  server.registerTool(
    "wiki_list",
    {
      description: ctx.prime.toolDescriptions.wiki_list,
      inputSchema: {
        domain: z.string().optional(),
        type: z.string().optional(),
        tag: z.string().optional(),
        entity: z.string().optional(),
        concept: z.string().optional(),
        limit: z.number().int().positive().max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => wikiListHandler(args, ctx),
  );
  table.set("wiki_list", (raw) => wikiListHandler(raw, ctx));

  server.registerTool(
    "wiki_upload",
    {
      description: ctx.prime.toolDescriptions.wiki_upload,
      inputSchema: {
        domain: z.string(),
        subpath: z.string(),
        content_base64: z.string(),
        message: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => wikiUploadHandler(args, ctx),
  );
  table.set("wiki_upload", (raw) => wikiUploadHandler(raw, ctx));

  server.registerTool(
    "wiki_read_raw",
    {
      description: ctx.prime.toolDescriptions.wiki_read_raw,
      inputSchema: { path: z.string() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => wikiReadRawHandler(args, ctx),
  );
  table.set("wiki_read_raw", (raw) => wikiReadRawHandler(raw, ctx));

  return {
    names: () => [...table.keys()],
    call: async (name: string, args: unknown): Promise<ToolResult> => {
      const h = table.get(name);
      if (!h) return errorResult(`Unknown tool: ${name}`);
      return h(args);
    },
  };
}

function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true };
}

const contextSchema = z.object({
  question: z.string(),
  domain: z.string().optional().default("all"),
  budget_tokens: z.number().optional().default(6000),
  expand_links: z.boolean().optional().default(false),
});
async function wikiContextHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = contextSchema.safeParse(raw);
  if (!parsed.success) return errorResult(parsed.error.message);
  try {
    const snap = await ctx.getSnapshot();
    const bundle = await buildContext(parsed.data, snap, ctx.github);
    return { content: [{ type: "text", text: renderContextMarkdown(bundle) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}

const searchSchema = z.object({
  query: z.string(),
  domain: z.string().optional().default("all"),
  limit: z.number().optional().default(10),
});
const SNIPPET_MAX_CHARS = 160;
const WIKILINK_ONLY_RE = /^\s*\[\[[^[\]]+\]\]\s*\.?\s*$/;

function extractSnippet(body: string): string {
  // First pass: assemble first paragraph (consecutive non-blank, non-heading,
  // non-frontmatter, non-wikilink-only lines).
  const collected: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (collected.length > 0) break;
      continue;
    }
    if (line.startsWith("#")) {
      if (collected.length > 0) break;
      continue;
    }
    if (line.startsWith("---")) continue;
    if (WIKILINK_ONLY_RE.test(line)) continue;
    collected.push(line);
  }
  if (collected.length > 0) {
    const joined = collected.join(" ");
    return joined.length > SNIPPET_MAX_CHARS
      ? `${joined.slice(0, SNIPPET_MAX_CHARS - 1)}…`
      : joined;
  }
  // Fallback: first non-empty heading text.
  for (const raw of body.split("\n")) {
    const h = raw.trim().match(/^#{1,3}\s+(.+)$/);
    if (h) return h[1];
  }
  return "";
}

async function wikiSearchHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = searchSchema.safeParse(raw);
  if (!parsed.success) return errorResult(parsed.error.message);

  try {
    const snap = await ctx.getSnapshot();
    const knownPaths = knownPathsOf(snap);
    const candidatePaths: string[] = [];
    for (const [name, dom] of snap.domains) {
      if (!isAllDomain(parsed.data.domain) && !eqIgnoreCase(parsed.data.domain, name)) continue;
      for (const [, paths] of dom.wikiTypes) {
        // Drop paths missing from the snapshot tree to avoid 404s in stage 2
        // when domain metadata drifts; mirrors the guard in wiki_fetch.
        for (const p of paths) if (knownPaths.has(p)) candidatePaths.push(p);
      }
    }

    // Stage 1: cheap path-token rank, then pad shortlist with the rest of
    // the corpus up to limit*2. Padding matters: a query may have zero or
    // few path-token matches, but a strong body+frontmatter match (e.g. tag).
    const metaDocs = candidatePaths.map((p) => ({ id: p, text: pathToText(p) }));
    const metaHits = rankDocs(parsed.data.query, metaDocs);
    const shortlistCap = parsed.data.limit * 2;
    const shortlist: string[] = [];
    const seen = new Set<string>();
    for (const h of metaHits) {
      if (shortlist.length >= shortlistCap) break;
      shortlist.push(h.id);
      seen.add(h.id);
    }
    for (const p of candidatePaths) {
      if (shortlist.length >= shortlistCap) break;
      if (!seen.has(p)) {
        shortlist.push(p);
        seen.add(p);
      }
    }

    // Stage 2: fetch bodies for shortlist, re-rank by body+frontmatter
    const bodies = await Promise.all(
      shortlist.map(async (p) => {
        try {
          return { path: p, body: await ctx.github.fetchBody(snap.sha, p) };
        } catch {
          return { path: p, body: "" };
        }
      }),
    );
    const bodyByPath = new Map(bodies.map((b) => [b.path, b.body]));
    const bodyDocs = bodies.map((b) => pageRankDoc(b.path, b.body));
    const bodyHits = rankDocs(parsed.data.query, bodyDocs);
    const finalRanked = (bodyHits.length > 0 ? bodyHits : metaHits).slice(0, parsed.data.limit);

    const rows: SearchRow[] = finalRanked.map((r) => {
      const body = bodyByPath.get(r.id) ?? "";
      const parsedPage = body ? parseFrontmatter(redactBody(body), { pathHint: r.id }) : null;
      const t = parsedPage?.title ?? r.id.split("/").pop()?.replace(/\.md$/, "") ?? r.id;
      const sn = parsedPage ? extractSnippet(parsedPage.body) : "";
      const row: SearchRow = { p: r.id, t, s: r.score };
      if (sn) row.sn = sn;
      return row;
    });
    return { content: [{ type: "text", text: renderSearchJSON(rows) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}

const fetchSchema = z.object({ paths: z.array(z.string()).max(20) });
async function wikiFetchHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = fetchSchema.safeParse(raw);
  if (!parsed.success) return errorResult(parsed.error.message);
  try {
    const snap = await ctx.getSnapshot();
    const knownPaths = knownPathsOf(snap);
    const denylist = sensitiveFrontmatterKeys(ctx.env);
    const out: FetchRow[] = await Promise.all(
      parsed.data.paths.map(async (p): Promise<FetchRow> => {
        if (!knownPaths.has(p)) return { p, err: "path not in snapshot" };
        try {
          const body = await ctx.github.fetchBody(snap.sha, p);
          const fm = parseFrontmatter(body, { pathHint: p });
          return { p, c: body, fm: filterFrontmatter(fm.data, denylist) };
        } catch (e) {
          return { p, err: (e as Error).message };
        }
      }),
    );
    return { content: [{ type: "text", text: renderFetchJSON(out) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}

const LIST_DEFAULT_LIMIT = 200;

const listSchema = z.object({
  domain: z.string().optional(),
  type: z.string().optional(),
  tag: z.string().optional(),
  entity: z.string().optional(),
  concept: z.string().optional(),
  limit: z.number().optional().default(LIST_DEFAULT_LIMIT),
  offset: z.number().optional().default(0),
});

type ListFilters = { tag?: string; entity?: string; concept?: string };

const FRONTMATTER_FILTER_KEYS: Array<{ field: keyof ListFilters; fmKey: string }> = [
  { field: "tag", fmKey: "tags" },
  { field: "entity", fmKey: "entities" },
  { field: "concept", fmKey: "concepts" },
];

function matchesFilters(fm: Record<string, unknown>, filters: ListFilters): boolean {
  for (const { field, fmKey } of FRONTMATTER_FILTER_KEYS) {
    const needle = filters[field];
    if (needle && !arrayIncludesIgnoreCase(toStringArray(fm[fmKey]), needle)) return false;
  }
  return true;
}

async function wikiListHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success) return errorResult(parsed.error.message);
  try {
    const snap = await ctx.getSnapshot();
    const flat: Array<{ p: string; t: string; type: string; domain: string }> = [];
    for (const [name, dom] of snap.domains) {
      if (!isAllDomain(parsed.data.domain) && !eqIgnoreCase(parsed.data.domain!, name)) continue;
      for (const [t, paths] of dom.wikiTypes) {
        if (parsed.data.type && !eqIgnoreCase(parsed.data.type, t)) continue;
        for (const p of paths) {
          const title = (p.split("/").pop() ?? p).replace(/\.md$/, "");
          flat.push({ p, t: title, type: t, domain: name });
        }
      }
    }

    const filters: ListFilters = {
      tag: parsed.data.tag,
      entity: parsed.data.entity,
      concept: parsed.data.concept,
    };
    const needsFrontmatter = !!(filters.tag || filters.entity || filters.concept);
    let rows = flat;
    if (needsFrontmatter) {
      const fmByPath = new Map<string, Record<string, unknown>>();
      await Promise.all(
        flat.map(async (it) => {
          try {
            const body = await ctx.github.fetchBody(snap.sha, it.p);
            fmByPath.set(it.p, parseFrontmatter(body, { pathHint: it.p }).data);
          } catch {
            fmByPath.set(it.p, {});
          }
        }),
      );
      rows = flat.filter((it) => matchesFilters(fmByPath.get(it.p) ?? {}, filters));
    }

    const offset = Math.max(0, parsed.data.offset);
    const limit = Math.max(1, parsed.data.limit);
    const paged = rows.slice(offset, offset + limit);

    const grouped: ListGrouped["g"] = {};
    for (const row of paged) {
      if (!grouped[row.domain]) grouped[row.domain] = {};
      if (!grouped[row.domain][row.type]) grouped[row.domain][row.type] = [];
      grouped[row.domain][row.type].push({ p: row.p, t: row.t });
    }

    const payload: ListGrouped = {
      g: grouped,
      tot: rows.length,
      off: offset,
      lim: limit,
      tr: rows.length > offset + limit,
    };
    return { content: [{ type: "text", text: renderListJSON(payload) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}

const uploadSchema = z.object({
  domain: z.string(),
  subpath: z.string(),
  content_base64: z.string(),
  message: z.string().optional(),
});
async function wikiUploadHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) return errorResult(`invalid input: ${parsed.error.message}`);
  try {
    const snap = await ctx.getSnapshot();
    const result = await uploadFile(parsed.data, snap, ctx.github, ctx.env);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}

const readRawSchema = z.object({ path: z.string() });
async function wikiReadRawHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = readRawSchema.safeParse(raw);
  if (!parsed.success) return errorResult(`invalid input: ${parsed.error.message}`);
  try {
    const snap = await ctx.getSnapshot();
    const result = await readRawFile(parsed.data, snap, ctx.github, ctx.env);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}
