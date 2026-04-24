# wiki-mcp

Read-only Model Context Protocol server that exposes an LLM-wiki vault (the [Karpathy pattern](https://karpathy.bearblog.dev)) to Claude clients. Runs free on Cloudflare Workers. Code is decoupled from any specific wiki — point it at your own private GitHub repo and deploy your own worker.

## What it does

Exposes four MCP tools:

- **`wiki_context(question, domain?, budget_tokens?)`** — primary tool; one call returns schema + indexes + recent log + ranked hits + one-hop wikilink expansion.
- **`wiki_search(query, domain?, limit?)`** — explicit ranked keyword search.
- **`wiki_fetch(paths[])`** — batch read pages by exact path (max 20).
- **`wiki_list(domain?, type?)`** — structured directory listing.

And four resources:

- `wiki://schema` — concatenated `CLAUDE.md` + `docs/llm-wiki.md` + per-domain `CLAUDE.md`.
- `wiki://index/all` — all discovered domain indexes.
- `wiki://log/recent` — last 50 log entries across domains.
- `wiki://page/{domain}/{type}/{slug}` — individual page template.

**Wiki layout is discovered at runtime** (any top-level dir with `index.md` + `log.md` + `wiki/` is a domain), so adding new domains or page types to your repo requires zero code change in this server.

## Prerequisites

- A GitHub repo (private OK) containing a wiki laid out per the LLM Wiki pattern.
- A Cloudflare account (free tier works — 100k requests/day).
- Node 20+, `npm`, `git`.

## Setup (5 steps)

```bash
# 1. Clone
git clone https://github.com/<your-gh-user>/wiki-mcp.git
cd wiki-mcp
pnpm install
pnpm prepare                                       # installs husky hooks

# 2. Configure wrangler.toml [vars].GITHUB_REPO to point at your wiki repo.
#    Example: GITHUB_REPO = "alice/my-wiki"
#             WIKI_SERVER_NAME = "alices-wiki"

# 3. Cloudflare login + secrets
pnpm exec wrangler login                           # one-time browser OAuth
openssl rand -hex 32                               # copy this token
pnpm exec wrangler secret put MCP_BEARER           # paste the openssl hex
pnpm exec wrangler secret put GITHUB_TOKEN         # paste a fine-grained PAT (contents:read)

# 4. Deploy
pnpm deploy
# => https://wiki-mcp.<your-subdomain>.workers.dev

# 5. Smoke-test
curl https://wiki-mcp.<your-subdomain>.workers.dev/health
# => {"ok":true,"at":"..."}
```

Requires pnpm 10+ and Node 20+.

### Creating the GitHub PAT

1. github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new.
2. Resource owner: your user.
3. Repository access: **only** the wiki repo.
4. Permissions → Repository permissions → **Contents: Read-only**.
5. Expiration: 1 year. Copy the token (shown once).

## Add the connector to Claude clients

### Claude Code

Add to `~/.claude.json` or project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "wiki": {
      "type": "http",
      "url": "https://wiki-mcp.<your-subdomain>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <your-bearer-token>" }
    }
  }
}
```

Restart Claude Code. Verify with `/mcp` or ask "list my MCP servers".

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the Windows equivalent, using the same JSON shape above. Restart the app.

### claude.ai web

Settings → Connectors → Add Custom Connector:

- **Name**: `wiki`
- **URL**: `https://wiki-mcp.<your-subdomain>.workers.dev/mcp`
- **Auth**: Bearer, value `<your-bearer-token>`

Create a Project, attach the connector, and paste project-level instructions such as:

> You have access to my personal knowledge wiki via the "wiki" MCP connector. Before answering questions that may involve my entities, concepts, or past sources, call `wiki_context`. Cite with `[[path]]` per the wiki convention.

## Configuration surface

Everything is env-driven. Fork this repo and point it at your wiki — no code changes required.

| Var / Secret | Set via | Purpose |
|--------------|---------|---------|
| `GITHUB_REPO` | `wrangler.toml [vars]` | Source repo `owner/name` |
| `GITHUB_BRANCH` | `wrangler.toml [vars]` | Branch to read (default `main`) |
| `WIKI_SERVER_NAME` | `wrangler.toml [vars]` | Server display name (in `instructions` field) |
| `CACHE_TTL_SECONDS` | `wrangler.toml [vars]` | Snapshot cache TTL (default `60`) |
| `SCHEMA_GLOBS` | `wrangler.toml [vars]` | Comma-list of schema file globs |
| `DOMAIN_REQUIRED_FILES` | `wrangler.toml [vars]` | Files that mark a dir as a domain |
| `MCP_BEARER` | `wrangler secret put` | Client auth bearer token |
| `MCP_BEARER_NEXT` | `wrangler secret put` | Optional overlap token for rotation |
| `GITHUB_TOKEN` | `wrangler secret put` | GitHub PAT, `contents:read` |

## Development

```bash
pnpm dev                   # wrangler dev, local server on :8787
pnpm test                  # vitest
pnpm test:coverage         # with coverage report
pnpm typecheck             # tsc --noEmit
pnpm lint                  # ultracite check (biome under the hood)
pnpm fix                   # ultracite fix
```

68 tests across unit, integration, and contract layers. Mocked GitHub fetch reads from `test/fixtures/vault/` — a synthetic mini-vault safe to be public.

## Tooling

- **pnpm** 10+ for package management
- **biome** + **ultracite** for linting and formatting
- **husky** + **lint-staged** for pre-commit checks
- **post-commit hook** auto-bumps `package.json` version (patch by default; `feat:` → minor; `!:` / `BREAKING CHANGE` → major) and amends into the same commit

## CI/CD

`.github/workflows/deploy.yml` runs `pnpm typecheck`, `pnpm test`, then `wrangler deploy` on every push to `main`. Set `CLOUDFLARE_API_TOKEN` in repo Settings → Secrets → Actions.

## Architecture

```
Claude client (Code / Desktop / claude.ai)
        │  JSON-RPC 2.0 over Streamable HTTP
        ▼
Cloudflare Worker     https://wiki-mcp.<subdomain>.workers.dev/mcp
        │   bearer-gated
        ▼
GitHub API + raw.githubusercontent.com   (your private wiki repo)
```

Stateless. Fresh `McpServer` per request, 60 s in-memory snapshot cache keyed by commit SHA. Page bodies fetched via SHA-pinned raw URLs — Cloudflare edge cache handles the rest.

## License

MIT. See `LICENSE`.
