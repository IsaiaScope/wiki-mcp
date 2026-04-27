<h3 align="center">wiki 📚</h3>

<br />

<p align="center">
  <img src="https://img.shields.io/badge/Pattern-LLM_Wiki-FF6B35" alt="LLM Wiki" />
  <img src="https://img.shields.io/badge/discovery-runtime-7C3AED" alt="runtime discovery" />
  <img src="https://img.shields.io/badge/format-Markdown_+_YAML-083FA1" alt="markdown" />
</p>

---

## 🔥 About

Everything that turns a flat list of file paths from the GitHub tree into the structured **`Snapshot`** the rest of the worker reasons about. This module owns the wiki *shape* — what counts as a domain, where its index/log live, how page types are grouped, and what `[[link]]` syntax means.

Wiki layout is discovered at runtime: any top-level directory containing the files listed in `DOMAIN_REQUIRED_FILES` (default `index.md,log.md`) plus a `wiki/` subfolder is treated as a domain. Adding or removing domains in your repo never requires a code change here.

## 🗂️ Files

| | File | Responsibility |
|-|------|----------------|
| 🔍 | `discover.ts` | `buildSnapshot(tree, env)` — turns a `TreeResponse` into a `Snapshot` (domains, schema paths, raw paths) |
| 📝 | `frontmatter.ts` | `parseFrontmatter(body, opts)` — YAML frontmatter, headings, title derivation via gray-matter |
| 🔗 | `wikilinks.ts` | `extractLinks(body)` + `resolveLink(link, paths)` — parses `[[path|alias#section]]` and resolves to a real file path |
| 📦 | `index.ts` | barrel export |

## 🧱 Domain model

```
Snapshot
├── sha             # commit SHA the snapshot is pinned to
├── fetchedAt       # ms timestamp for staleness checks
├── domains         # Map<name, Domain>
├── allPaths        # all blob paths (flat list)
└── schemaPaths     # paths matching SCHEMA_GLOBS

Domain
├── name            # top-level folder name (e.g. "personal")
├── indexPath       # {name}/index.md
├── logPath         # {name}/log.md
├── claudeMdPath?   # {name}/CLAUDE.md if present
├── wikiTypes       # Map<type, paths[]>  (e.g. "entities" → […])
└── rawPaths        # {name}/raw/** — used by wiki_upload + future ingestion
```

## 🚫 Skipped top-level dirs

`discover.ts` ignores: `.git`, `.github`, `docs`, `mcp`, `node_modules`, `.obsidian`, `.trash`, and any dotfile-prefixed directory. Add to `SKIP_TOP_DIRS` if your wiki has more.

## 🧪 Testing

- `test/unit/discover.test.ts` — domain detection, type bucketing, raw-path collection
- `test/unit/frontmatter.test.ts` — YAML round-trips, title fallback, heading extraction
- `test/unit/wikilinks.test.ts` — link parsing (alias + section), cross-domain resolution
