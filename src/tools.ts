import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildContext } from "./context";
import type { Env } from "./env";
import { parseFrontmatter } from "./frontmatter";
import type { GithubClient } from "./github";
import { rankDocs } from "./rank";
import type { Snapshot } from "./types";

export type ToolContext = {
  env: Env;
  github: GithubClient;
  getSnapshot: () => Promise<Snapshot>;
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
      description:
        "Return a full knowledge bundle (schema + indexes + log tail + ranked hits + one-hop link expansion) for a question. Primary tool; call this first for wiki-relevant questions.",
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
      description:
        "Explicit keyword search over wiki metadata. Returns ranked {path,title,snippet,score}.",
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
      description: "Batch read pages by path. Max 20 paths per call.",
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
      description: "List discovered pages, optionally filtered by domain and/or type.",
      inputSchema: {
        domain: z.string().optional(),
        type: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => wikiListHandler(args, ctx),
  );
  table.set("wiki_list", (raw) => wikiListHandler(raw, ctx));

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
    const results = ranked.map((r) => ({
      path: r.id,
      title: r.id.split("/").pop()?.replace(/\.md$/, "") ?? r.id,
      snippet: "",
      score: r.score,
    }));
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
