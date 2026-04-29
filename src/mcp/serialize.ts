import type { Bundle } from "../types";

export function renderContextMarkdown(bundle: Bundle): string {
  const parts: string[] = ["# wiki_context", ""];
  for (const hit of bundle.hits) {
    const score = hit.score.toFixed(2);
    const via = hit.viaParent ? `  via=${hit.viaParent}` : "";
    parts.push(`[hit] ${hit.path}  score=${score}  truncated=${hit.truncated}${via}`);
    if (hit.body) parts.push(hit.body);
    parts.push("");
  }
  parts.push(`[cite] ${bundle.citation_instructions}`);
  return parts.join("\n");
}
