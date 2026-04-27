import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildContext } from "./context";
import type { Env } from "./env";
import { parseFrontmatter } from "./frontmatter";
import type { GithubClient } from "./github";
import { rankDocs } from "./rank";
import type { PrimeBundle, Snapshot } from "./types";
import { uploadFile } from "./upload";

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

function extractSnippet(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("---")) continue;
    if (line.startsWith("[[") && line.endsWith("]]")) continue;
    return line.length > SNIPPET_MAX_CHARS ? `${line.slice(0, SNIPPET_MAX_CHARS - 1)}…` : line;
  }
  // Fallback: first non-empty heading text.
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const h = line.match(/^#{1,3}\s+(.+)$/);
    if (h) return h[1];
  }
  return "";
}

async function wikiSearchHandler(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = searchSchema.safeParse(raw);
  if (!parsed.success) return errorResult(parsed.error.message);

  try {
    const snap = await ctx.getSnapshot();
    const docs: Array<{ id: string; text: string }> = [];
    for (const [name, dom] of snap.domains) {
      if (parsed.data.domain !== "all" && parsed.data.domain !== name) continue;
      for (const [, paths] of dom.wikiTypes) {
        for (const p of paths) {
          docs.push({ id: p, text: p.replace(/[/_-]/g, " ").replace(/\.md$/, "") });
        }
      }
    }
    const ranked = rankDocs(parsed.data.query, docs).slice(0, parsed.data.limit);

    // Fetch bodies for top-k only; parallel, tolerant of individual failures.
    const bodies = await Promise.all(
      ranked.map(async (r) => {
        try {
          return { path: r.id, body: await ctx.github.fetchBody(snap.sha, r.id) };
        } catch {
          return { path: r.id, body: "" };
        }
      }),
    );
    const bodyByPath = new Map(bodies.map((b) => [b.path, b.body]));

    const results = ranked.map((r) => {
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
    const out = await Promise.all(
      parsed.data.paths.map(async (p) => {
        try {
          const body = await ctx.github.fetchBody(snap.sha, p);
          const fm = parseFrontmatter(body, { pathHint: p });
          return { path: p, content: body, frontmatter: fm.data };
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
    return { content: [{ type: "text", text: JSON.stringify(items) }] };
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
