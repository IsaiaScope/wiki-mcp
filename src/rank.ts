const STOPWORDS_EN = new Set([
  "the","a","an","is","are","was","were","be","been","being",
  "and","or","but","if","then","of","in","on","at","for","to","from","by","with",
  "this","that","these","those","it","its","as","so","not","no","yes","do","does","did",
  "has","have","had","i","me","my","you","your","he","she","we","us","our","they","them","their"
]);

const STOPWORDS_IT = new Set([
  "il","lo","la","i","gli","le","un","una","uno","di","a","da","in","con","su","per","tra","fra",
  "e","o","ma","se","che","chi","cui","non","si","no","sono","era","ero","siamo","siete","essere",
  "avere","ho","hai","ha","abbiamo","avete","hanno","come","quando","dove","perche","ecco","questa","questo"
]);

const STOPWORDS = new Set<string>([...STOPWORDS_EN, ...STOPWORDS_IT]);

export function tokenize(input: string): string[] {
  const out: string[] = [];

  const phrases: string[] = [];
  const rest = input.replace(/"([^"]+)"/g, (_m, p1: string) => {
    phrases.push(p1.toLowerCase());
    return " ";
  });

  for (const p of phrases) out.push(p);

  for (const raw of rest.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }

  return out;
}

export type RankDoc = {
  id: string;
  text: string;
  weightedTerms?: string[];
};

export type RankHit = { id: string; score: number };

const K1 = 1.2;
const B = 0.75;
const PHRASE_BONUS = 5;

function extractQuotedPhrases(query: string): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) out.push(m[1].toLowerCase());
  return out;
}

export function rankDocs(query: string, docs: RankDoc[]): RankHit[] {
  const qTokens = tokenize(query).filter(t => !t.includes(" "));
  const phrases = extractQuotedPhrases(query);
  if (qTokens.length === 0 && phrases.length === 0) return [];

  const docTokenLists = docs.map(d => {
    const tokens = tokenize(d.text);
    if (d.weightedTerms) {
      for (const t of d.weightedTerms) {
        const extras = tokenize(t);
        tokens.push(...extras, ...extras);
      }
    }
    return tokens;
  });

  const avgDl = docTokenLists.reduce((s, t) => s + t.length, 0) / Math.max(1, docTokenLists.length);

  const df = new Map<string, number>();
  for (const tokens of docTokenLists) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const N = docs.length;
  const hits: RankHit[] = [];

  for (let i = 0; i < docs.length; i++) {
    const tokens = docTokenLists[i];
    const dl = tokens.length || 1;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const q of qTokens) {
      const n = df.get(q) ?? 0;
      if (n === 0) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = tf.get(q) ?? 0;
      const numerator = f * (K1 + 1);
      const denominator = f + K1 * (1 - B + (B * dl) / avgDl);
      score += idf * (denominator === 0 ? 0 : numerator / denominator);
    }

    // Phrase bonus: direct substring match against the doc's original text.
    const haystack = docs[i].text.toLowerCase();
    for (const phrase of phrases) {
      if (haystack.includes(phrase)) score += PHRASE_BONUS;
    }

    if (score > 0) hits.push({ id: docs[i].id, score });
  }

  return hits.sort((a, b) => b.score - a.score);
}

export function bm25Score(query: string, text: string): number {
  const hits = rankDocs(query, [{ id: "x", text }]);
  return hits[0]?.score ?? 0;
}
