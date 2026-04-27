<h3 align="center">wiki-mcp 🔥</h3>

<br />

<p align="center">
  <img src="https://img.shields.io/badge/MCP-2025--06--18-D97757?logo=anthropic&logoColor=white" alt="MCP" />
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vitest-1.6-6E9F18?logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/Node-20-339933?logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/Biome-linter-60A5FA?logo=biome&logoColor=white" alt="Biome" />
</p>

---

## 🔥 About

Model Context Protocol server that exposes an LLM-wiki vault (the [Karpathy pattern](https://karpathy.bearblog.dev)) to Claude clients. **Read** access for the four primary tools, plus a single **write** path (`wiki_upload`) that commits arbitrary files into the wiki repo. Runs free on Cloudflare Workers — point it at your own private GitHub repo and deploy your own worker.

Companion to [`wikionfire`](https://github.com/IsaiaScope/wikionfire) but agnostic — it works with any wiki shaped like the Karpathy pattern.

## 🛠️ Five MCP tools

| | Tool | Purpose | Mode |
|-|------|---------|------|
| 🎁 | **`wiki_context(question, domain?, budget_tokens?)`** | one-shot knowledge bundle (schema + indexes + log tail + ranked hits + 1-hop link expansion) | read |
| 🔍 | **`wiki_search(query, domain?, limit?)`** | ranked keyword search with `{path, title, snippet, score}` | read |
| 📄 | **`wiki_fetch(paths[])`** | batch read pages by exact path (max 20) | read |
| 🗂️ | **`wiki_list(domain?, type?)`** | structured directory listing | read |
| ⬆️ | **`wiki_upload(domain, subpath, content_base64, message?)`** | upload any file (PDF, image, text, binary) under `{domain}/raw/{subpath}` — 25 MB cap, requires `contents:write` | **write** |

## 📚 Six MCP resources

| | Resource | Source |
|-|----------|--------|
| 📜 | `wiki://schema` | `CLAUDE.md` + `docs/llm-wiki.md` + per-domain `CLAUDE.md` concatenated |
| 🗂️ | `wiki://index/all` | every discovered domain `index.md` |
| 📅 | `wiki://log/recent` | last 50 log entries across all domains |
| 📄 | `wiki://page/{domain}/{type}/{slug}` | individual page template |
| 🌐 | `wiki://overview` | dynamic top-level inventory (built from snapshot) |
| 🌐 | `wiki://overview/{domain}` | per-domain page list grouped by type |

**Wiki layout is discovered at runtime** — any top-level dir with `index.md` + `log.md` + `wiki/` is a domain. Adding new domains or page types in your repo requires zero code change here.

## 🗂️ Source layout

The worker is split into seven feature-scoped modules. Each has its own README.

```
src/
├── index.ts          worker entry — HTTP routing
├── server.ts         createServer + buildDeps (state lives here)
├── env.ts            config + helpers
├── types.ts          shared types
│
├── auth/             📖 README — bearer-token guard
├── github/           📖 README — REST + raw fetch + write
├── wiki/             📖 README — discover + frontmatter + wikilinks
├── search/           📖 README — BM25 + budget + bundle
├── prime/            📖 README — dynamic instructions + overview
├── mcp/              📖 README — tool + resource registration
└── upload/           📖 README — write path + sanitizer
```

| | Module | Owns |
|-|--------|------|
| 🔐 | [`auth/`](src/auth/) | constant-time bearer check, 401 helper, overlap-token rotation |
| 🐙 | [`github/`](src/github/) | tree fetch (TTL-cached), SHA-pinned raw URL builder, contents API write |
| 📚 | [`wiki/`](src/wiki/) | runtime domain discovery, YAML frontmatter, `[[link\|alias#section]]` parsing |
| 🔍 | [`search/`](src/search/) | BM25 ranking, token budget, full bundle assembly |
| 🪄 | [`prime/`](src/prime/) | dynamic `instructions`, tool descriptions, `wiki://overview` resources |
| 🔌 | [`mcp/`](src/mcp/) | tool + resource registration, zod schemas, error surface |
| ⬆️ | [`upload/`](src/upload/) | write orchestrator, subpath sanitizer, size cap |

## ⚙️ Setup

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
pnpm exec wrangler secret put GITHUB_TOKEN         # paste a fine-grained PAT

# 4. Deploy
pnpm deploy
# => https://wiki-mcp.<your-subdomain>.workers.dev

# 5. Smoke-test
curl https://wiki-mcp.<your-subdomain>.workers.dev/health
# => {"ok":true,"at":"..."}
```

Requires pnpm 10+ and Node 20+.

### 🔑 GitHub PAT (fine-grained)

1. github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new.
2. Resource owner: your user.
3. Repository access: **only** the wiki repo.
4. Permissions → Repository permissions → **Contents: Read and write** (write is required by `wiki_upload`; leave at read-only if you do not plan to use that tool).
5. Expiration: 1 year. Copy the token (shown once).

## 🔌 Add the connector to Claude

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

Restart Claude Code. Verify with `/mcp`.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the Windows equivalent, using the same JSON shape above. Restart the app.

### claude.ai web

Settings → Connectors → Add Custom Connector:

- **Name**: `wiki`
- **URL**: `https://wiki-mcp.<your-subdomain>.workers.dev/mcp`
- **Auth**: Bearer, value `<your-bearer-token>`

Create a Project, attach the connector, and paste project-level instructions such as:

> You have access to my personal knowledge wiki via the "wiki" MCP connector. Before answering questions that may involve my entities, concepts, or past sources, call `wiki_context`. Cite with `[[path]]` per the wiki convention.

## ⚙️ Configuration surface

Everything is env-driven. Fork this repo and point it at your wiki — no code changes required.

| | Var / Secret | Set via | Purpose |
|-|--------------|---------|---------|
| 🐙 | `GITHUB_REPO` | `wrangler.toml [vars]` | Source repo `owner/name` |
| 🌿 | `GITHUB_BRANCH` | `wrangler.toml [vars]` | Branch to read (default `main`) |
| 🏷️ | `WIKI_SERVER_NAME` | `wrangler.toml [vars]` | Server display name (in `instructions`) |
| ⏱️ | `CACHE_TTL_SECONDS` | `wrangler.toml [vars]` | Snapshot cache TTL (default `60`) |
| 📜 | `SCHEMA_GLOBS` | `wrangler.toml [vars]` | Comma-list of schema file globs |
| 🧱 | `DOMAIN_REQUIRED_FILES` | `wrangler.toml [vars]` | Files that mark a dir as a domain |
| 📏 | `MAX_UPLOAD_BYTES` | `wrangler.toml [vars]` | Max upload size in bytes (default `26214400` = 25 MB) |
| 📁 | `RAW_FOLDER` | `wrangler.toml [vars]` | Subfolder under each domain for `wiki_upload` (default `raw`) |
| 🪄 | `WIKI_PRIME_VOCAB` | `wrangler.toml [vars]` | Priming privacy: `structural` (default), `full`, or `off` |
| 👋 | `WIKI_PRIME_GREETING` | `wrangler.toml [vars]` | Optional one-line greeting prepended to instructions and overview |
| 🔐 | `MCP_BEARER` | `wrangler secret put` | Client auth bearer token |
| 🔁 | `MCP_BEARER_NEXT` | `wrangler secret put` | Optional overlap token for rotation |
| 🐙 | `GITHUB_TOKEN` | `wrangler secret put` | GitHub PAT — `contents:read` minimum, `contents:write` for `wiki_upload` |

## 🪄 Server priming

On every `initialize`, the server emits a dynamic `instructions` field computed from your wiki's actual shape (domains, types, page counts). Privacy is controlled by `WIKI_PRIME_VOCAB`:

| | Mode | Behavior |
|-|------|----------|
| 🛡️ | `structural` (default) | per-domain page counts and type breakdown — no titles in passive surfaces |
| 🔥 | `full` | titles injected into instructions + tool descriptions, capped at 50/30 |
| 🔇 | `off` | minimal greeting only, no enumeration |

Two overview resources are always exposed:

- `wiki://overview` — domain map with per-domain slice URIs
- `wiki://overview/{domain}` — page listing for one domain, each page as a `[[path]]` link with a prettified title

See [`src/prime/`](src/prime/) for the full design.

## 🧪 Development

```bash
pnpm dev                   # wrangler dev, local server on :8787
pnpm test                  # vitest (174 tests)
pnpm test:coverage         # with coverage report
pnpm typecheck             # tsc --noEmit
pnpm lint                  # ultracite check (biome under the hood)
pnpm fix                   # ultracite fix
```

**174 tests** across unit, integration, and contract layers. Mocked GitHub fetch reads from `test/fixtures/vault/` — a synthetic mini-vault safe to be public.

## 🛠️ Tooling

| | Tool | Role |
|-|------|------|
| 📦 | **pnpm** 10+ | package manager |
| 🧹 | **biome** + **ultracite** | linter + formatter |
| 🪝 | **husky** + **lint-staged** | pre-commit checks |
| 🔢 | **post-commit hook** | auto-bumps `package.json` version (patch by default; `feat:` → minor; `!:` / `BREAKING CHANGE` → major) |

## 🚀 CI/CD + branch flow

Two protected branches, no direct pushes:

- **`dev`** — default branch, integration target. PRs must pass the `test` job (typecheck + vitest).
- **`prod`** — release branch. PR merges from `dev` trigger deploy to Cloudflare Workers.

```
  feature branch ──PR──► dev (CI: test + deploy-dev) ──PR──► prod (CI: test + deploy)
```

`.github/workflows/deploy.yml`:
- `pull_request` on `dev` or `prod` → runs `pnpm typecheck` + `pnpm test`
- `push` to `prod` (only via PR merge) → runs tests then `wrangler deploy`

Required repo secret: `CLOUDFLARE_API_TOKEN` in Settings → Secrets → Actions (single token covers both workers — same Cloudflare account).

Per-environment secrets are independent — set them once each before first deploy:

```bash
# Production
pnpm exec wrangler secret put MCP_BEARER
pnpm exec wrangler secret put GITHUB_TOKEN

# Dev (separate worker, separate secrets)
pnpm exec wrangler secret put MCP_BEARER --env dev
pnpm exec wrangler secret put GITHUB_TOKEN --env dev
```

Use a different `MCP_BEARER` per environment so a leaked dev token can't read prod and vice versa.

Protection rules on both branches: require PR, require `test` check, no force push, no deletion, admins enforced.

## 🏛️ Architecture

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

## 📖 Reading

- Pattern — [Karpathy gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- Companion wiki — [wikionfire](https://github.com/IsaiaScope/wikionfire)
- Per-module READMEs — `src/<module>/README.md`

## 📄 License

MIT. See [`LICENSE`](LICENSE).

---

<p align="center">
  Made with 🧠 and a lot of TypeScript.
</p>
