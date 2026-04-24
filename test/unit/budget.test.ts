import { describe, expect, it } from "vitest";
import { estimateTokens, truncateAtHeading } from "../../src/budget";

describe("estimateTokens", () => {
  it("approximates ~1.3 tokens per word", () => {
    const text = "one two three four five";
    expect(estimateTokens(text)).toBe(7);
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts non-empty code blocks as words", () => {
    const text = "intro code more";
    expect(estimateTokens(text)).toBeGreaterThan(0);
  });
});

describe("truncateAtHeading", () => {
  it("leaves content alone if under budget", () => {
    const body = "# H1\n\nsmall body";
    const out = truncateAtHeading(body, 1000);
    expect(out.truncated).toBe(false);
    expect(out.text).toBe(body);
  });

  it("cuts at nearest H2 boundary before budget", () => {
    const body = [
      "# Top",
      "",
      `intro paragraph ${"x ".repeat(40)}`,
      "",
      "## First",
      `first section ${"y ".repeat(40)}`,
      "",
      "## Second",
      `second section ${"z ".repeat(40)}`,
    ].join("\n");

    const out = truncateAtHeading(body, 60);
    expect(out.truncated).toBe(true);
    expect(out.text).toContain("# Top");
    expect(out.text).toMatch(/\[…truncated/);
    expect(out.text).not.toContain("## Second");
  });

  it("appends citation pointer with path", () => {
    const long = `# T\n${"word ".repeat(500)}`;
    const out = truncateAtHeading(long, 20, { path: "personal/wiki/entities/Foo.md" });
    expect(out.text).toMatch(/\[…truncated, full at personal\/wiki\/entities\/Foo\.md\]/);
  });
});
