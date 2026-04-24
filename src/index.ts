import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "./env";
import { checkBearer, unauthorized } from "./auth";
import { createServer } from "./server";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    const handle = await createServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    await handle.raw.connect(transport);

    const response = await transport.handleRequest(request);
    ctx.waitUntil(Promise.resolve());
    return response;
  }
};
