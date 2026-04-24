import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./tools";

export type ResourceContext = ToolContext;

export type ReadResult = { contents: Array<{ uri: string; text: string }> };

export function registerResources(server: McpServer, ctx: ResourceContext) {
  const table = new Map<string, () => Promise<ReadResult>>();

  server.registerResource(
    "schema",
    "wiki://schema",
    { description: "Concatenated root + domain CLAUDE.md + docs/llm-wiki.md", mimeType: "text/markdown" },
    async () => readSchema(ctx)
  );
  table.set("wiki://schema", () => readSchema(ctx));

  server.registerResource(
    "index-all",
    "wiki://index/all",
    { description: "All domain indexes concatenated", mimeType: "text/markdown" },
    async () => readIndexAll(ctx)
  );
  table.set("wiki://index/all", () => readIndexAll(ctx));

  server.registerResource(
    "log-recent",
    "wiki://log/recent",
    { description: "Last 50 log entries across all domains", mimeType: "text/markdown" },
    async () => readLogRecent(ctx)
  );
  table.set("wiki://log/recent", () => readLogRecent(ctx));

  server.registerResource(
    "page",
    new ResourceTemplate("wiki://page/{domain}/{type}/{slug}", { list: undefined }),
    { description: "Individual wiki page", mimeType: "text/markdown" },
    async (uri, variables) => {
      const { domain, type, slug } = variables as { domain: string; type: string; slug: string };
      return readPage(ctx, String(domain), String(type), String(slug), uri.toString());
    }
  );

  return {
    uris: () => [...table.keys()],
    read: async (uri: string): Promise<ReadResult> => {
      const direct = table.get(uri);
      if (direct) return direct();
      const m = uri.match(/^wiki:\/\/page\/([^/]+)\/([^/]+)\/(.+)$/);
      if (m) return readPage(ctx, decodeURIComponent(m[1]), decodeURIComponent(m[2]), decodeURIComponent(m[3]), uri);
      throw new Error(`Unknown resource URI: ${uri}`);
    }
  };
}

async function readSchema(ctx: ResourceContext): Promise<ReadResult> {
  const snap = await ctx.getSnapshot();
  const parts: string[] = [];
  for (const p of snap.schemaPaths) {
    const body = await safeFetch(ctx, snap.sha, p);
    if (body) parts.push(`--- ${p} ---\n` + body);
  }
  return { contents: [{ uri: "wiki://schema", text: parts.join("\n\n") }] };
}

async function readIndexAll(ctx: ResourceContext): Promise<ReadResult> {
  const snap = await ctx.getSnapshot();
  const parts: string[] = [];
  for (const [, dom] of snap.domains) {
    const body = await safeFetch(ctx, snap.sha, dom.indexPath);
    if (body) parts.push(body);
  }
  return { contents: [{ uri: "wiki://index/all", text: parts.join("\n\n") }] };
}

async function readLogRecent(ctx: ResourceContext): Promise<ReadResult> {
  const snap = await ctx.getSnapshot();
  const lines: string[] = [];
  for (const [, dom] of snap.domains) {
    const body = await safeFetch(ctx, snap.sha, dom.logPath);
    for (const line of body.split("\n")) {
      if (/^##\s+\[/.test(line)) lines.push(line.trim());
    }
  }
  const recent = lines.sort().reverse().slice(0, 50).join("\n");
  return { contents: [{ uri: "wiki://log/recent", text: recent }] };
}

async function readPage(ctx: ResourceContext, domain: string, type: string, slug: string, uri: string): Promise<ReadResult> {
  const snap = await ctx.getSnapshot();
  const slugWithExt = slug.endsWith(".md") ? slug : `${slug}.md`;
  const target = `${domain}/wiki/${type}/${slugWithExt}`;
  const body = snap.allPaths.includes(target)
    ? await safeFetch(ctx, snap.sha, target)
    : "";
  return { contents: [{ uri, text: body }] };
}

async function safeFetch(ctx: ResourceContext, sha: string, path: string): Promise<string> {
  try {
    return await ctx.github.fetchBody(sha, path);
  } catch {
    return "";
  }
}
