import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Snapshot } from "../types";

export type PromptContext = {
  getSnapshot: () => Promise<Snapshot>;
};

/**
 * Auto-generates a small set of slash-command-style prompts from the snapshot.
 * Clients render these as user-invokable shortcuts. Prompt bodies steer the
 * model toward calling the right wiki tool with the right arguments — they are
 * not themselves answers.
 */
export function registerPrompts(server: McpServer, ctx: PromptContext) {
  server.registerPrompt(
    "wiki_summary",
    {
      description: "Summarize the contents of one wiki domain (or the whole wiki).",
      argsSchema: { domain: z.string().optional() },
    },
    async (args) => {
      const domain = args?.domain;
      const snap = await ctx.getSnapshot();
      const known = [...snap.domains.keys()];
      const target = domain && snap.domains.has(domain) ? domain : "all";
      const scope = target === "all" ? "across all domains" : `inside the '${target}' domain`;
      const text =
        `Call wiki_context with question="Summarize the wiki ${scope}: list domains, types, and the most prominent entities/concepts." and domain="${target}". ` +
        `If you need a quick map first, read wiki://overview${target === "all" ? "" : `/${target}`}. ` +
        `Known domains: [${known.join(", ") || "(none)"}]. Cite findings with [[path]].`;
      return {
        messages: [{ role: "user", content: { type: "text" as const, text } }],
      };
    },
  );

  server.registerPrompt(
    "wiki_recent",
    {
      description: "Show recent activity from log.md across the wiki.",
      argsSchema: { domain: z.string().optional() },
    },
    async (args) => {
      const domain = args?.domain;
      const snap = await ctx.getSnapshot();
      const target = domain && snap.domains.has(domain) ? domain : "all";
      const text =
        `Read the wiki://log/recent resource (or call wiki_context with include_log=true and domain="${target}") and produce a chronological digest of the last week of changes. ` +
        `Group entries by date, then by domain. Highlight new pages, follow-ups, and anything tagged 'urgent'.`;
      return {
        messages: [{ role: "user", content: { type: "text" as const, text } }],
      };
    },
  );

  server.registerPrompt(
    "wiki_related",
    {
      description: "Find pages that link to or share concepts with a given page.",
      argsSchema: { path: z.string() },
    },
    async (args) => {
      const path = args?.path ?? "";
      const text =
        `Use wiki_fetch to read ${path}, extract its frontmatter (entities, concepts, tags) and outgoing [[wikilinks]]. ` +
        `Then call wiki_search for each tag/entity/concept term, and wiki_list with type filters to surface related pages. ` +
        `Return a deduped list of related paths with one-line reasons.`;
      return {
        messages: [{ role: "user", content: { type: "text" as const, text } }],
      };
    },
  );
}
