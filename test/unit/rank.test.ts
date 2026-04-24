import { describe, it, expect } from "vitest";
import { tokenize, rankDocs } from "../../src/rank";

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
  });

  it("removes English stopwords", () => {
    expect(tokenize("the cat is on the mat")).toEqual(["cat", "mat"]);
  });

  it("removes Italian stopwords", () => {
    expect(tokenize("la dolce vita e il lavoro")).toEqual(["dolce", "vita", "lavoro"]);
  });

  it("preserves quoted phrases as compound tokens", () => {
    expect(tokenize(`find "la busta paga" please`)).toContain("la busta paga");
  });

  it("keeps duplicate tokens on input (dedup is BM25's job)", () => {
    expect(tokenize("cat cat cat")).toEqual(["cat", "cat", "cat"]);
  });
});

describe("rankDocs", () => {
  it("returns higher score for docs that contain query terms", () => {
    const docs = [
      { id: "a", text: "tfr is severance money in italy" },
      { id: "b", text: "unrelated document about weather" }
    ];
    const ranked = rankDocs("tfr severance", docs);
    expect(ranked[0].id).toBe("a");
  });

  it("rewards multi-term matches over single-term", () => {
    const docs = [
      { id: "both", text: "tfr severance" },
      { id: "one",  text: "tfr alone" }
    ];
    const ranked = rankDocs("tfr severance", docs);
    expect(ranked[0].id).toBe("both");
  });

  it("respects quoted-phrase boost", () => {
    const docs = [
      { id: "phrase", text: "la busta paga is the payslip" },
      { id: "terms",  text: "busta paga split elsewhere la" }
    ];
    const ranked = rankDocs(`"la busta paga"`, docs);
    expect(ranked[0].id).toBe("phrase");
  });

  it("returns empty array for empty query", () => {
    const docs = [{ id: "a", text: "anything" }];
    expect(rankDocs("", docs)).toEqual([]);
  });

  it("scores with weighted-terms signal (frontmatter repeats)", () => {
    const docs = [
      { id: "heavy", text: "tfr", weightedTerms: ["tfr", "tfr", "tfr"] },
      { id: "plain", text: "tfr" }
    ];
    const ranked = rankDocs("tfr", docs);
    expect(ranked[0].id).toBe("heavy");
  });
});
