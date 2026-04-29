import type { Bundle, FetchRow, ListGrouped, SearchRow } from "../types";

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
  parts.push(`[ctx] schema/indexes/log at wiki://schema, wiki://index/all, wiki://log/recent`);
  return parts.join("\n");
}

export function renderListJSON(payload: ListGrouped): string {
  return JSON.stringify(payload);
}

export function renderSearchJSON(rows: SearchRow[]): string {
  const out = rows.map((r) => {
    const obj: SearchRow = { p: r.p, t: r.t, s: Math.round(r.s * 100) / 100 };
    if (r.sn) obj.sn = r.sn;
    return obj;
  });
  return JSON.stringify(out);
}

export function renderFetchJSON(rows: FetchRow[]): string {
  return JSON.stringify(rows);
}
