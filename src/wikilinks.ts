const LINK_RE = /\[\[([^\[\]|#]+?)(?:#[^\[\]|]+)?(?:\|[^\[\]]+)?\]\]/g;

export function extractLinks(markdown: string): string[] {
  const seen = new Set<string>();
  for (const m of markdown.matchAll(LINK_RE)) {
    seen.add(m[1].trim());
  }
  return [...seen];
}

export function resolveLink(
  link: string,
  sourcePath: string,
  allPaths: string[]
): string | null {
  const target = link.endsWith(".md") ? link : `${link}.md`;

  if (allPaths.includes(target)) return target;

  const domain = sourcePath.split("/")[0];
  const domainCandidate = `${domain}/wiki/${target}`;
  if (allPaths.includes(domainCandidate)) return domainCandidate;

  for (const p of allPaths) {
    if (p.endsWith(`/wiki/${target}`)) return p;
  }

  return null;
}
