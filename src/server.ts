import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "./env";
import { GithubClient } from "./github";
import { buildSnapshot } from "./discover";
import { registerTools, type ToolContext, type ToolResult } from "./tools";
import { registerResources, type ResourceContext, type ReadResult } from "./resources";
import type { Snapshot } from "./types";

export type ServerHandle = {
  raw: McpServer;
  listToolNames: () => string[];
  listResourceUris: () => string[];
  callTool: (name: string, args: unknown) => Promise<ToolResult>;
  readResource: (uri: string) => Promise<ReadResult>;
};

export type ServerDeps = {
  github: GithubClient;
  getSnapshot: () => Promise<Snapshot>;
};

export function buildDeps(env: Env): ServerDeps {
  const github = new GithubClient(env);
  let snapshot: Snapshot | null = null;
  const getSnapshot = async () => {
    const tree = await github.fetchTree();
    if (!snapshot || snapshot.sha !== tree.sha) {
      snapshot = buildSnapshot(tree, env);
    }
    return snapshot;
  };
  return { github, getSnapshot };
}

export async function createServer(env: Env, deps?: ServerDeps): Promise<ServerHandle> {
  const { github, getSnapshot } = deps ?? buildDeps(env);
  await getSnapshot();

  const server = new McpServer(
    { name: env.WIKI_SERVER_NAME, version: "0.1.0" },
    {
      instructions: `Personal knowledge wiki for ${env.WIKI_SERVER_NAME}. Call wiki_context before answering questions that may involve wiki knowledge (entities, concepts, sources, personal or work topics). Cite with [[path]]. Domains are discovered at runtime; read wiki://index/all to see the current layout. Never invent sources or pages not present in the wiki.`
    }
  );

  const ctx: ToolContext & ResourceContext = { env, github, getSnapshot };
  const tools = registerTools(server, ctx);
  const resources = registerResources(server, ctx);

  return {
    raw: server,
    listToolNames: () => tools.names(),
    listResourceUris: () => resources.uris(),
    callTool: (n, a) => tools.call(n, a),
    readResource: uri => resources.read(uri)
  };
}
