import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkBearer, unauthorized } from "./auth";
import { assertEnv, type Env } from "./env";
import { buildDeps, createServer, type ServerDeps } from "./server";

let cachedDeps: ServerDeps | null = null;
let cachedRepo: string | null = null;

function getDeps(env: Env): ServerDeps {
  assertEnv(env);
  const key = `${env.GITHUB_REPO}@${env.GITHUB_BRANCH}`;
  if (!cachedDeps || cachedRepo !== key) {
    cachedDeps = buildDeps(env);
    cachedRepo = key;
  }
  return cachedDeps;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, at: new Date().toISOString() });
    }

    // OAuth discovery probes from MCP clients (RFC 9728 / MCP 2025-06-18).
    // We do not run an OAuth server — bearer-only auth. Return a JSON 404
    // so SDKs can parse it and fall back to the static Authorization header
    // configured by the client.
    if (
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      return Response.json(
        { error: "not_found", reason: "wiki-mcp uses static bearer auth, not OAuth" },
        { status: 404 },
      );
    }

    if (url.pathname !== "/mcp") {
      return Response.json({ error: "not_found", path: url.pathname }, { status: 404 });
    }

    if (!checkBearer(request, { primary: env.MCP_BEARER, next: env.MCP_BEARER_NEXT })) {
      return unauthorized();
    }

    const deps = getDeps(env);

    // Stale-while-revalidate: if snapshot is older than TTL, schedule a
    // background refresh and serve the current (stale) snapshot to this request.
    if (deps.isStale()) {
      ctx.waitUntil(
        deps.refresh().catch(() => {
          // swallow errors — next request retries cold path
        }),
      );
    }

    const handle = await createServer(env, deps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await handle.raw.connect(transport);

    return transport.handleRequest(request);
  },
};
