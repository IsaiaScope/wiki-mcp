const KNOWN_ACRONYMS = new Set(["CCNL", "TFR", "ID", "URL", "API", "MCP", "LLM"]);

export function prettifyTitle(raw: string): string {
  if (!raw) return "";
  const stripped = raw.replace(/\.md$/i, "");

  // Handle ISO date patterns (YYYY-MM-DD) specially to preserve hyphens
  const dateMatch = stripped.match(/^(\d{4}-\d{2}-\d{2})-(.*)$/);
  let datePart = "";
  let remaining = stripped;

  if (dateMatch) {
    datePart = dateMatch[1];
    remaining = dateMatch[2];
  }

  const parts = remaining.split(/[-_\s]+/).filter(Boolean);
  const processedParts = parts.map((part) => {
    const up = part.toUpperCase();
    if (KNOWN_ACRONYMS.has(up)) return up;
    if (/^\d/.test(part)) return part; // keep date/number runs verbatim
    if (/[A-Z]/.test(part)) return part; // preserve existing cased words
    return part.charAt(0).toUpperCase() + part.slice(1);
  });

  const result = processedParts.join(" ");
  return datePart ? `${datePart} ${result}` : result;
}
