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
    // We do not run an OAuth server — bearer-only auth. Return a valid
    // RFC 9728 protected-resource metadata document with no authorization
    // servers and bearer-via-header advertised. Some MCP clients (e.g.
    // Claude Code) do an upfront probe and refuse to connect when this
    // endpoint 404s; serving the spec-compliant metadata satisfies them
    // without requiring a real OAuth flow.
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      const mcpUrl = `${url.origin}/mcp`;
      return Response.json({
        resource: mcpUrl,
        bearer_methods_supported: ["header"],
        resource_name: env.WIKI_SERVER_NAME,
      });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      // No OAuth authorization server. Return 404 (RFC 8414) — caller falls
      // back gracefully when this is missing because we already advertised
      // bearer-only via the protected-resource metadata above.
      return Response.json(
        { error: "not_found", reason: "wiki-mcp uses static bearer auth, no OAuth AS" },
        { status: 404 },
      );
    }

    if (url.pathname !== "/mcp") {
      return Response.json({ error: "not_found", path: url.pathname }, { status: 404 });
    }

    if (!checkBearer(request, { primary: env.MCP_BEARER, next: env.MCP_BEARER_NEXT })) {
      return unauthorized(`${url.origin}/.well-known/oauth-protected-resource`);
    }

    // Stateless transport (sessionIdGenerator: undefined) cannot serve the
    // optional GET-SSE listening channel: the SDK opens an unbounded
    // ReadableStream with no writer, which Workers cancels as a "hung
    // request" after a few ms. Reject GET up-front so MCP clients (e.g.
    // Claude Code) immediately fall back to POST JSON-RPC instead of
    // looping on cancelled SSE attempts.
    if (request.method === "GET") {
      return new Response(null, { status: 405, headers: { Allow: "POST, DELETE" } });
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
