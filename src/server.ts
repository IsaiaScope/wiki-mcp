import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json";
import { assertEnv, type Env } from "./env";
import { GithubClient } from "./github";
import {
  type ReadResult,
  type ResourceContext,
  registerPrompts,
  registerResources,
  registerTools,
  type ToolContext,
  type ToolResult,
} from "./mcp";
import { buildPrime } from "./prime";
import type { PrimeBundle, Snapshot } from "./types";
import { buildSnapshot } from "./wiki";

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
  getPrime: () => Promise<PrimeBundle>;
  refresh: () => Promise<Snapshot>;
  isStale: () => boolean;
};

export function buildDeps(env: Env): ServerDeps {
  assertEnv(env);
  const github = new GithubClient(env);
  let snapshot: Snapshot | null = null;
  let prime: PrimeBundle | null = null;

  const rebuild = (s: Snapshot): Snapshot => {
    snapshot = s;
    prime = buildPrime(s, env);
    if (prime.vocabMode !== "off") {
      let titleCount = 0;
      for (const perType of prime.overviewByDomain.values()) {
        titleCount += (perType.match(/^- \[\[/gm) ?? []).length;
      }
      console.log(
        `[prime] rebuilt sha=${s.sha.slice(0, 7)} domains=${s.domains.size} vocabMode=${prime.vocabMode} titles=${titleCount}`,
      );
    }
    return s;
  };

  const refresh = async (): Promise<Snapshot> => {
    github.invalidate();
    const tree = await github.fetchTree();
    return rebuild(buildSnapshot(tree, env));
  };

  const getSnapshot = async (): Promise<Snapshot> => {
    if (snapshot) return snapshot;
    const tree = await github.fetchTree();
    return rebuild(buildSnapshot(tree, env));
  };

  const getPrime = async (): Promise<PrimeBundle> => {
    if (prime) return prime;
    await getSnapshot();
    // rebuild() sets both snapshot and prime synchronously, so prime is non-null after getSnapshot resolves
    return prime!;
  };

  const isStale = (): boolean => !snapshot || github.isStale();

  return { github, getSnapshot, getPrime, refresh, isStale };
}

export async function createServer(env: Env, deps?: ServerDeps): Promise<ServerHandle> {
  const resolved = deps ?? buildDeps(env);
  const { github, getSnapshot, getPrime } = resolved;
  await getSnapshot();
  const prime = await getPrime();

  const server = new McpServer(
    { name: env.WIKI_SERVER_NAME, version: pkg.version },
    { instructions: prime.instructions },
  );

  const ctx: ToolContext & ResourceContext = { env, github, getSnapshot, getPrime, prime };
  const tools = registerTools(server, ctx);
  const resources = registerResources(server, ctx);
  registerPrompts(server, { getSnapshot });

  return {
    raw: server,
    listToolNames: () => tools.names(),
    listResourceUris: () => resources.uris(),
    callTool: (n, a) => tools.call(n, a),
    readResource: (uri) => resources.read(uri),
  };
}
