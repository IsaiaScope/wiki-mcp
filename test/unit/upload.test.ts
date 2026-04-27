import { describe, expect, it } from "vitest";
import { checkSize, sanitizeSubpath } from "../../src/upload";

describe("sanitizeSubpath", () => {
  it("accepts a normal single-file path", () => {
    expect(sanitizeSubpath("docs/2026/test.pdf")).toBe("docs/2026/test.pdf");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeSubpath("  test.pdf  ")).toBe("test.pdf");
  });

  it("collapses repeated slashes", () => {
    expect(sanitizeSubpath("docs//2026///test.pdf")).toBe("docs/2026/test.pdf");
  });

  it("rejects '..' traversal", () => {
    expect(() => sanitizeSubpath("../evil.pdf")).toThrow(/traversal/);
    expect(() => sanitizeSubpath("docs/../../evil.pdf")).toThrow(/traversal/);
  });

  it("rejects absolute paths", () => {
    expect(() => sanitizeSubpath("/docs/test.pdf")).toThrow(/traversal/);
  });

  it("rejects backslash", () => {
    expect(() => sanitizeSubpath("docs\\test.pdf")).toThrow(/traversal/);
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeSubpath("docs/test\0.pdf")).toThrow(/invalid/);
  });

  it("rejects empty subpath", () => {
    expect(() => sanitizeSubpath("")).toThrow(/empty/);
    expect(() => sanitizeSubpath("   ")).toThrow(/empty/);
  });

  it("rejects more than 8 segments", () => {
    expect(() => sanitizeSubpath("a/b/c/d/e/f/g/h/i.pdf")).toThrow(/segments/);
  });

  it("rejects a segment longer than 255 chars", () => {
    const long = `${"x".repeat(260)}.pdf`;
    expect(() => sanitizeSubpath(long)).toThrow(/segment/);
  });

  it("rejects trailing slash (not a file)", () => {
    expect(() => sanitizeSubpath("docs/")).toThrow(/segment/);
  });
});

describe("checkSize", () => {
  it("accepts base64 within cap", () => {
    expect(() => checkSize("AAAA", 1024)).not.toThrow();
  });

  it("rejects base64 over encoded-length ceiling", () => {
    expect(() => checkSize("A".repeat(100), 3)).toThrow(/too large/);
  });

  it("rejects when decoded raw bytes exceed cap", () => {
    const b64 = Buffer.from("hello world!").toString("base64");
    expect(() => checkSize(b64, 11)).toThrow(/too large/);
  });

  it("accepts exactly at cap", () => {
    const b64 = Buffer.from("hello").toString("base64");
    expect(() => checkSize(b64, 5)).not.toThrow();
  });

  it("rejects invalid base64", () => {
    expect(() => checkSize("***not-base64***", 1024)).toThrow(/base64/);
  });

  it("rejects empty content", () => {
    expect(() => checkSize("", 1024)).toThrow(/empty/);
  });
});
