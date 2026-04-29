import { describe, expect, it } from "vitest";
import { renderContextMarkdown } from "../../src/mcp/serialize";
import type { Bundle } from "../../src/types";

describe("renderContextMarkdown", () => {
  it("emits header, hits with metadata line, and trailing cite line", () => {
    const bundle: Bundle = {
      hits: [
        {
          path: "personal/wiki/entities/Foo.md",
          score: 0.83,
          body: "# Foo\n\nBody text.",
          truncated: false,
        },
      ],
      citation_instructions: "Cite with [[path]].",
    };
    const out = renderContextMarkdown(bundle);
    expect(out.startsWith("# wiki_context\n")).toBe(true);
    expect(out).toContain("[hit] personal/wiki/entities/Foo.md  score=0.83  truncated=false");
    expect(out).toContain("# Foo\n\nBody text.");
    expect(out.trimEnd().endsWith("[cite] Cite with [[path]].")).toBe(true);
  });

  it("emits viaParent on expansion hits", () => {
    const bundle: Bundle = {
      hits: [
        { path: "a.md", score: 0.7, body: "A", truncated: false },
        {
          path: "b.md",
          score: 0,
          body: "B",
          truncated: true,
          viaParent: "a.md",
        },
      ],
      citation_instructions: "ci",
    };
    const out = renderContextMarkdown(bundle);
    expect(out).toContain("[hit] b.md  score=0.00  truncated=true  via=a.md");
  });

  it("returns a header + cite line even when hits are empty", () => {
    const out = renderContextMarkdown({ hits: [], citation_instructions: "ci" });
    expect(out).toContain("# wiki_context");
    expect(out).toContain("[cite] ci");
  });
});
