import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Env, filterFrontmatter, sensitiveFrontmatterKeys } from "../env";
import type { GithubClient } from "../github";
import { readRawFile } from "../raw";
import { buildContext, pageRankDoc, rankDocs } from "../search";
import type { PrimeBundle, Snapshot } from "../types";
import { uploadFile } from "../upload";
import { parseFrontmatter } from "../wiki";

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
        include_log: z.boolean().optional(),
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
  include_log: z.boolean().optional().default(true),
});
async function wikiContextHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = contextSchema.safeParse(raw);
  if (!parsed.success) return errorResult(parsed.error.message);
  try {
    const snap = await ctx.getSnapshot();
    const bundle = await buildContext(parsed.data, snap, ctx.github, ctx.env);
    return { content: [{ type: "text", text: JSON.stringify(bundle) }] };
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
    const candidatePaths: string[] = [];
    for (const [name, dom] of snap.domains) {
      if (parsed.data.domain !== "all" && parsed.data.domain !== name) continue;
      for (const [, paths] of dom.wikiTypes) candidatePaths.push(...paths);
    }

    // Stage 1: cheap path-token rank, then pad shortlist with the rest of
    // the corpus up to limit*2. Padding matters: a query may have zero or
    // few path-token matches, but a strong body+frontmatter match (e.g. tag).
    const metaDocs = candidatePaths.map((p) => ({
      id: p,
      text: p.replace(/[/_-]/g, " ").replace(/\.md$/, ""),
    }));
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

    const results = finalRanked.map((r) => {
      const body = bodyByPath.get(r.id) ?? "";
      const parsedPage = body ? parseFrontmatter(body, { pathHint: r.id }) : null;
      return {
        path: r.id,
        title: parsedPage?.title ?? r.id.split("/").pop()?.replace(/\.md$/, "") ?? r.id,
        snippet: parsedPage ? extractSnippet(parsedPage.body) : "",
        score: r.score,
      };
    });
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
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
    const knownPaths = new Set(snap.allPaths);
    const denylist = sensitiveFrontmatterKeys(ctx.env);
    const out = await Promise.all(
      parsed.data.paths.map(async (p) => {
        if (!knownPaths.has(p)) {
          return { path: p, content: "", frontmatter: {}, error: "path not in snapshot" };
        }
        try {
          const body = await ctx.github.fetchBody(snap.sha, p);
          const fm = parseFrontmatter(body, { pathHint: p });
          return { path: p, content: body, frontmatter: filterFrontmatter(fm.data, denylist) };
        } catch (e) {
          return { path: p, content: "", frontmatter: {}, error: (e as Error).message };
        }
      }),
    );
    return { content: [{ type: "text", text: JSON.stringify(out) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}

const listSchema = z.object({
  domain: z.string().optional(),
  type: z.string().optional(),
  tag: z.string().optional(),
  entity: z.string().optional(),
  concept: z.string().optional(),
});
async function wikiListHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success) return errorResult(parsed.error.message);
  try {
    const snap = await ctx.getSnapshot();
    const items: Array<{ path: string; title: string; type: string; domain: string }> = [];
    for (const [name, dom] of snap.domains) {
      if (parsed.data.domain && parsed.data.domain !== name) continue;
      for (const [t, paths] of dom.wikiTypes) {
        if (parsed.data.type && parsed.data.type !== t) continue;
        for (const p of paths) {
          const title = (p.split("/").pop() ?? p).replace(/\.md$/, "");
          items.push({ path: p, title, type: t, domain: name });
        }
      }
    }

    const needsFrontmatter = !!(parsed.data.tag || parsed.data.entity || parsed.data.concept);
    if (!needsFrontmatter) {
      return { content: [{ type: "text", text: JSON.stringify(items) }] };
    }

    // Lazy frontmatter index — body cache amortizes repeat calls.
    const fmByPath = new Map<string, Record<string, unknown>>();
    await Promise.all(
      items.map(async (it) => {
        try {
          const body = await ctx.github.fetchBody(snap.sha, it.path);
          fmByPath.set(it.path, parseFrontmatter(body, { pathHint: it.path }).data);
        } catch {
          fmByPath.set(it.path, {});
        }
      }),
    );

    const filtered = items.filter((it) => {
      const fm = fmByPath.get(it.path) ?? {};
      if (parsed.data.tag && !asStringArray(fm.tags).includes(parsed.data.tag)) return false;
      if (parsed.data.entity && !asStringArray(fm.entities).includes(parsed.data.entity))
        return false;
      if (parsed.data.concept && !asStringArray(fm.concepts).includes(parsed.data.concept))
        return false;
      return true;
    });

    return { content: [{ type: "text", text: JSON.stringify(filtered) }] };
  } catch (e) {
    return errorResult((e as Error).message);
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
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
