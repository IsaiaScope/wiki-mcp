export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

export type TruncOpts = { path?: string };
export type TruncResult = { text: string; truncated: boolean };

export function truncateAtHeading(body: string, budgetTokens: number, opts: TruncOpts = {}): TruncResult {
  if (estimateTokens(body) <= budgetTokens) {
    return { text: body, truncated: false };
  }

  const lines = body.split("\n");
  let acc = "";
  let accTokens = 0;
  let lastSafeCut = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokens(line);
    if (/^#{1,3}\s/.test(line) && i > 0) {
      lastSafeCut = acc.length;
    }
    if (accTokens + lineTokens > budgetTokens) break;
    acc += (acc ? "\n" : "") + line;
    accTokens += lineTokens;
  }

  const cut = lastSafeCut > 0 ? acc.slice(0, lastSafeCut) : acc;
  const pointer = opts.path
    ? `\n\n[…truncated, full at ${opts.path}]`
    : `\n\n[…truncated]`;
  return { text: cut.trimEnd() + pointer, truncated: true };
}
