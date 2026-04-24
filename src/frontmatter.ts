import matter from "gray-matter";

export type ParsedPage = {
  data: Record<string, unknown>;
  body: string;
  title: string;
  headings: string[];
};

export type ParseOptions = { pathHint?: string };

export function parseFrontmatter(raw: string, opts: ParseOptions = {}): ParsedPage {
  const parsed = matter(raw);
  const data = parsed.data ?? {};
  const body = parsed.content ?? "";

  const title = pickTitle(data, body, opts.pathHint);
  const headings = firstTwoH2(body);

  return { data, body, title, headings };
}

function pickTitle(
  data: Record<string, unknown>,
  body: string,
  pathHint: string | undefined
): string {
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  if (pathHint) {
    const base = pathHint.split("/").pop() ?? pathHint;
    return base.replace(/\.md$/i, "");
  }
  return "(untitled)";
}

function firstTwoH2(body: string): string[] {
  const matches = body.match(/^##\s+(.+?)\s*$/gm);
  if (!matches) return [];
  return matches.slice(0, 2).map(m => m.replace(/^##\s+/, "").trim());
}
