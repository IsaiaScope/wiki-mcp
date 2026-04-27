<h3 align="center">mcp 🔌</h3>

<br />

<p align="center">
  <img src="https://img.shields.io/badge/MCP-2025--06--18-D97757?logo=anthropic&logoColor=white" alt="MCP" />
  <img src="https://img.shields.io/badge/transport-Streamable_HTTP-3178C6" alt="Streamable HTTP" />
  <img src="https://img.shields.io/badge/SDK-@modelcontextprotocol/sdk-181717" alt="MCP SDK" />
</p>

---

## 🔥 About

Wires the worker to the Model Context Protocol. This is where every tool and resource is registered with the `McpServer` and bound to its handler. Read tools delegate to `search/`, the write tool delegates to `upload/`, resources delegate to `wiki/` + `prime/`.

There is no business logic in this module — only schema, registration, error wrapping, and dispatch. That keeps the protocol surface easy to audit (every tool in one place) and the underlying modules testable in isolation.

## 🗂️ Files

| | File | Responsibility |
|-|------|----------------|
| 🛠️ | `tools.ts` | `registerTools(server, ctx)` — registers the five tools, parses inputs with zod, dispatches to handlers |
| 📚 | `resources.ts` | `registerResources(server, ctx)` — registers `wiki://schema`, `wiki://index/all`, `wiki://log/recent`, `wiki://page/{...}`, `wiki://overview`, `wiki://overview/{domain}` |
| 📦 | `index.ts` | barrel export |

## 🛠️ Tools surface

| | Tool | Purpose | Annotations |
|-|------|---------|-------------|
| 🎁 | `wiki_context(question, domain?, budget_tokens?)` | one-shot knowledge bundle | readOnly, idempotent |
| 🔍 | `wiki_search(query, domain?, limit?)` | ranked keyword search | readOnly, idempotent |
| 📄 | `wiki_fetch(paths[])` | batch read by path (max 20) | readOnly, idempotent |
| 🗂️ | `wiki_list(domain?, type?)` | filtered directory listing | readOnly, idempotent |
| ⬆️ | `wiki_upload(domain, subpath, content_base64, message?)` | write a file under `{domain}/raw/{subpath}` | **write**, non-idempotent |

The `wiki_upload` description is dynamic — it lists the actual discovered domains so the agent doesn't have to guess. The other four pull their descriptions from `prime/` (which optionally appends trigger vocabulary in `full` mode).

## 📚 Resources surface

| | Resource | Purpose |
|-|----------|---------|
| 📜 | `wiki://schema` | concatenated `CLAUDE.md` + `docs/llm-wiki.md` + per-domain `CLAUDE.md` |
| 🗂️ | `wiki://index/all` | every discovered `index.md` |
| 📅 | `wiki://log/recent` | last 50 log entries across domains |
| 📄 | `wiki://page/{domain}/{type}/{slug}` | individual page template |
| 🌐 | `wiki://overview` | dynamic top-level inventory (from prime) |
| 🌐 | `wiki://overview/{domain}` | dynamic per-domain page list (from prime) |

## 🛡️ Error handling

Every handler is wrapped in `try/catch` that returns a `ToolResult` with `isError: true` and a `text` block of `ERROR: …`. Zod parse failures surface as `ERROR: invalid input: …`. The MCP spec requires errors to flow through `tool/result` content rather than JSON-RPC errors — that's what we do.

## 🧪 Testing

- `test/integration/tools.test.ts` — every tool's success + key error paths through `createServer`
- `test/integration/resources.test.ts` — every resource over the same path
- `test/contract/mcp.test.ts` — full JSON-RPC round-trip with `InMemoryTransport`
- `test/contract/upload-contract.test.ts` — upload-specific contract verification
