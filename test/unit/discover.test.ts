import { describe, expect, it } from "vitest";
import type { TreeResponse } from "../../src/github";
import { buildSnapshot } from "../../src/wiki";
import { loadFixtureTree, makeEnv } from "../helpers";

describe("buildSnapshot", () => {
  it("discovers both domains from fixture tree", () => {
    const tree = loadFixtureTree() as TreeResponse;
    const snap = buildSnapshot(tree, makeEnv());

    expect([...snap.domains.keys()].sort()).toEqual(["personal", "work"]);
  });

  it("records index + log + claudeMd paths per domain", () => {
    const tree = loadFixtureTree() as TreeResponse;
    const snap = buildSnapshot(tree, makeEnv());

    const personal = snap.domains.get("personal")!;
    expect(personal.indexPath).toBe("personal/index.md");
    expect(personal.logPath).toBe("personal/log.md");
    expect(personal.claudeMdPath).toBe("personal/CLAUDE.md");

    const work = snap.domains.get("work")!;
    expect(work.claudeMdPath).toBeUndefined();
  });

  it("groups wiki pages by type", () => {
    const tree = loadFixtureTree() as TreeResponse;
    const snap = buildSnapshot(tree, makeEnv());

    const personal = snap.domains.get("personal")!;
    expect(personal.wikiTypes.get("entities")).toEqual(["personal/wiki/entities/Foo.md"]);
    expect(personal.wikiTypes.get("concepts")).toEqual(["personal/wiki/concepts/bar-baz.md"]);
    expect(personal.wikiTypes.get("sources")).toEqual([
      "personal/wiki/sources/2026-01-01-sample.md",
    ]);
  });

  it("collects raw paths separately", () => {
    const tree = loadFixtureTree() as TreeResponse;
    const snap = buildSnapshot(tree, makeEnv());

    expect(snap.domains.get("personal")!.rawPaths).toEqual(["personal/raw/note.pdf"]);
  });

  it("collects schema paths via SCHEMA_GLOBS", () => {
    const tree = loadFixtureTree() as TreeResponse;
    const snap = buildSnapshot(tree, makeEnv());

    expect(snap.schemaPaths.sort()).toEqual(
      ["CLAUDE.md", "docs/llm-wiki.md", "personal/CLAUDE.md"].sort(),
    );
  });

  it("skips non-domain top-level dirs (.git, docs, etc.)", () => {
    const tree = loadFixtureTree() as TreeResponse;
    const snap = buildSnapshot(tree, makeEnv());
    expect(snap.domains.has("docs")).toBe(false);
  });

  it("picks up a new domain if its dir has index.md + log.md + wiki/", () => {
    const tree: TreeResponse = {
      sha: "z",
      truncated: false,
      tree: [
        { path: "research/index.md", type: "blob", sha: "a", mode: "100644" },
        { path: "research/log.md", type: "blob", sha: "b", mode: "100644" },
        { path: "research/wiki/concepts/x.md", type: "blob", sha: "c", mode: "100644" },
      ],
    };
    const snap = buildSnapshot(tree, makeEnv());
    expect(snap.domains.has("research")).toBe(true);
    expect(snap.domains.get("research")!.wikiTypes.get("concepts")).toEqual([
      "research/wiki/concepts/x.md",
    ]);
  });
});
