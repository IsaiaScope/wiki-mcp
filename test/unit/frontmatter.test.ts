import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../src/wiki";

describe("parseFrontmatter", () => {
  it("extracts frontmatter and body", () => {
    const input = `---
title: Foo
tags: [alpha, beta]
entities: ["Fincons S.p.A."]
---

# Foo

Body text here.`;
    const out = parseFrontmatter(input);
    expect(out.data.title).toBe("Foo");
    expect(out.data.tags).toEqual(["alpha", "beta"]);
    expect(out.data.entities).toEqual(["Fincons S.p.A."]);
    expect(out.body.trim().startsWith("# Foo")).toBe(true);
  });

  it("returns empty data when no frontmatter", () => {
    const out = parseFrontmatter("# Just a heading\nbody");
    expect(out.data).toEqual({});
    expect(out.body).toContain("# Just a heading");
  });

  it("extracts first two H2 headings from body", () => {
    const input = `---
title: Page
---

## First

text

## Second

text

## Third`;
    const out = parseFrontmatter(input);
    expect(out.headings).toEqual(["First", "Second"]);
  });

  it("derives title from H1 if frontmatter missing title", () => {
    const out = parseFrontmatter("# Derived Title\n\nbody");
    expect(out.title).toBe("Derived Title");
  });

  it("falls back title to basename hint (no H1, no frontmatter)", () => {
    const out = parseFrontmatter("body without title", {
      pathHint: "personal/wiki/entities/Foo.md",
    });
    expect(out.title).toBe("Foo");
  });
});
