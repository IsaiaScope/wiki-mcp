import { describe, expect, it } from "vitest";
import { extractLinks, resolveLink } from "../../src/wikilinks";

const ALL_PATHS = [
  "personal/wiki/entities/Foo.md",
  "personal/wiki/entities/Fincons S.p.A..md",
  "personal/wiki/concepts/bar-baz.md",
  "work/wiki/entities/Qux.md",
];

describe("extractLinks", () => {
  it("extracts simple [[link]]", () => {
    expect(extractLinks("See [[entities/Foo]].")).toEqual(["entities/Foo"]);
  });

  it("extracts alias links [[target|alias]] returning target", () => {
    expect(extractLinks("See [[entities/Foo|Mr. Foo]].")).toEqual(["entities/Foo"]);
  });

  it("extracts section links [[target#section]] returning target", () => {
    expect(extractLinks("See [[concepts/bar-baz#summary]].")).toEqual(["concepts/bar-baz"]);
  });

  it("dedupes repeated links", () => {
    expect(extractLinks("[[x]] and [[x]] and [[y]]")).toEqual(["x", "y"]);
  });

  it("ignores markdown links that aren't wiki-style", () => {
    expect(extractLinks("[not a wikilink](http://x)")).toEqual([]);
  });
});

describe("resolveLink", () => {
  it("resolves bare name against current domain", () => {
    expect(resolveLink("entities/Foo", "personal/wiki/entities/A.md", ALL_PATHS)).toBe(
      "personal/wiki/entities/Foo.md",
    );
  });

  it("resolves absolute-style path [[personal/wiki/entities/Foo]]", () => {
    expect(resolveLink("personal/wiki/entities/Foo", "work/wiki/entities/Q.md", ALL_PATHS)).toBe(
      "personal/wiki/entities/Foo.md",
    );
  });

  it("preserves spaces and dots in entity names", () => {
    expect(resolveLink("entities/Fincons S.p.A.", "personal/wiki/sources/x.md", ALL_PATHS)).toBe(
      "personal/wiki/entities/Fincons S.p.A..md",
    );
  });

  it("returns null for unresolvable link", () => {
    expect(resolveLink("entities/Missing", "personal/wiki/entities/A.md", ALL_PATHS)).toBeNull();
  });

  it("searches across domains when not found in current", () => {
    expect(resolveLink("entities/Qux", "personal/wiki/entities/A.md", ALL_PATHS)).toBe(
      "work/wiki/entities/Qux.md",
    );
  });
});
