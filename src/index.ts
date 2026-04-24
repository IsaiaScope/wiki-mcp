import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "./env";
import { checkBearer, unauthorized } from "./auth";
import { createServer, buildDeps, type ServerDeps } from "./server";

let cachedDeps: ServerDeps | null = null;
let cachedRepo: string | null = null;

function getDeps(env: Env): ServerDeps {
  const key = `${env.GITHUB_REPO}@${env.GITHUB_BRANCH}`;
  if (!cachedDeps || cachedRepo !== key) {
    cachedDeps = buildDeps(env);
    cachedRepo = key;
  }
  return cachedDeps;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, at: new Date().toISOString() });
    }

    if (url.pathname !== "/mcp") {
      return new Response("not found", { status: 404 });
    }

    if (!checkBearer(request, { primary: env.MCP_BEARER, next: env.MCP_BEARER_NEXT })) {
      return unauthorized();
    }

    const handle = await createServer(env, getDeps(env));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    await handle.raw.connect(transport);

    return transport.handleRequest(request);
  }
};
