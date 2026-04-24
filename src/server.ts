import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildSnapshot } from "./discover";
import { assertEnv, type Env } from "./env";
import { GithubClient } from "./github";
import { type ReadResult, type ResourceContext, registerResources } from "./resources";
import { registerTools, type ToolContext, type ToolResult } from "./tools";
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
  refresh: () => Promise<Snapshot>;
  isStale: () => boolean;
};

export function buildDeps(env: Env): ServerDeps {
  assertEnv(env);
  const github = new GithubClient(env);
  let snapshot: Snapshot | null = null;

  const refresh = async (): Promise<Snapshot> => {
    github.invalidate();
    const tree = await github.fetchTree();
    snapshot = buildSnapshot(tree, env);
    return snapshot;
  };

  const getSnapshot = async (): Promise<Snapshot> => {
    if (snapshot) return snapshot;
    // Cold start: must block on the first fetch.
    const tree = await github.fetchTree();
    snapshot = buildSnapshot(tree, env);
    return snapshot;
  };

  const isStale = (): boolean => !snapshot || github.isStale();

  return { github, getSnapshot, refresh, isStale };
}

export async function createServer(env: Env, deps?: ServerDeps): Promise<ServerHandle> {
  const resolved = deps ?? buildDeps(env);
  const { github, getSnapshot } = resolved;
  await getSnapshot();

  const server = new McpServer(
    { name: env.WIKI_SERVER_NAME, version: "0.1.0" },
    {
      instructions: `Personal knowledge wiki for ${env.WIKI_SERVER_NAME}. Call wiki_context before answering questions that may involve wiki knowledge (entities, concepts, sources, personal or work topics). Cite with [[path]]. Domains are discovered at runtime; read wiki://index/all to see the current layout. Never invent sources or pages not present in the wiki.`,
    },
  );

  const ctx: ToolContext & ResourceContext = { env, github, getSnapshot };
  const tools = registerTools(server, ctx);
  const resources = registerResources(server, ctx);

  return {
    raw: server,
    listToolNames: () => tools.names(),
    listResourceUris: () => resources.uris(),
    callTool: (n, a) => tools.call(n, a),
    readResource: (uri) => resources.read(uri),
  };
}
