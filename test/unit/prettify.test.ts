import { describe, expect, it } from "vitest";
import { prettifyTitle } from "../../src/prime";

describe("prettifyTitle", () => {
  it("kebab-case → title case, known acronyms uppercased", () => {
    expect(prettifyTitle("ccnl-metalmeccanico")).toBe("CCNL Metalmeccanico");
  });

  it("preserves existing capitalization and dots in filenames", () => {
    expect(prettifyTitle("A.Agrati SPA")).toBe("A.Agrati SPA");
  });

  it("dated source filenames: keep dates, titlecase words", () => {
    expect(prettifyTitle("2026-04-24-fincons-busta-paga-2023")).toBe(
      "2026-04-24 Fincons Busta Paga 2023",
    );
  });

  it("lowercase acronym → uppercase acronym", () => {
    expect(prettifyTitle("tfr")).toBe("TFR");
  });

  it("multi-word kebab with mixed acronym", () => {
    expect(prettifyTitle("llm-wiki-pattern")).toBe("LLM Wiki Pattern");
  });

  it("snake_case normalized like kebab", () => {
    expect(prettifyTitle("my_personal_notes")).toBe("My Personal Notes");
  });

  it("strips .md extension if present", () => {
    expect(prettifyTitle("some-page.md")).toBe("Some Page");
  });

  it("empty string returns empty string", () => {
    expect(prettifyTitle("")).toBe("");
  });

  it("already-prettified titles pass through", () => {
    expect(prettifyTitle("Already Pretty")).toBe("Already Pretty");
  });

  it("unicode/Italian characters preserved", () => {
    expect(prettifyTitle("così-fà")).toBe("Così Fà");
  });
});
