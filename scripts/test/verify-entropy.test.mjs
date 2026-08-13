import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  extractFileRefs,
  buildSuffixIndex,
  refResolves,
} from "../verify-entropy.mjs";

describe("extractFileRefs", () => {
  it("extracts backtick-wrapped file paths with extensions", () => {
    const content = "See `src/model/worksheet/sheet.ts` for details.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "src/model/worksheet/sheet.ts", source: "test.md" },
    ]);
  });

  it("extracts markdown link targets with file extensions", () => {
    const content = "Check [the doc](packages/sheets/README.md) here.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "packages/sheets/README.md", source: "test.md" },
    ]);
  });

  it("ignores URLs", () => {
    const content = "See `https://example.com/file.ts` for info.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, []);
  });

  it("ignores paths inside fenced code blocks", () => {
    const content = [
      "Some text.",
      "```json",
      '{ "entry": "src/main.ts" }',
      "```",
      "See `src/real.ts` here.",
    ].join("\n");
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "src/real.ts", source: "test.md" },
    ]);
  });

  it("strips anchor fragments from markdown link targets", () => {
    const content = "See [section](README.md#overview) for details.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "README.md", source: "test.md" },
    ]);
  });

  it("deduplicates repeated references in the same file", () => {
    const content = "Use `src/a.ts` and then `src/a.ts` again.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "src/a.ts", source: "test.md" },
    ]);
  });
});

describe("buildSuffixIndex", () => {
  it("groups tracked paths by basename", () => {
    const index = buildSuffixIndex([
      "packages/cli/src/output/formatter.ts",
      "packages/docs/src/output/formatter.ts",
      "README.md",
    ]);
    assert.deepStrictEqual(index.get("formatter.ts"), [
      "packages/cli/src/output/formatter.ts",
      "packages/docs/src/output/formatter.ts",
    ]);
    assert.deepStrictEqual(index.get("README.md"), ["README.md"]);
    assert.equal(index.get("missing.ts"), undefined);
  });
});

describe("refResolves", () => {
  // A miniature repo: a root, a nested design doc, and packages whose files are
  // only reachable from the root by their full path.
  let root;
  let bases;
  const suffixIndex = buildSuffixIndex([
    "packages/cli/src/output/formatter.ts",
    "packages/frontend/src/api/documents.ts",
    "packages/frontend/src/types/documents.ts",
    "packages/backend/scripts/copy-yorkie-documents.ts",
    "legacy-api/documents.ts",
    "docs/design/cli.md",
    "docs/design/docs/docs.md",
  ]);

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "entropy-resolver-"));
    await mkdir(path.join(root, "docs/design/docs"), { recursive: true });
    await mkdir(path.join(root, "packages/cli/src/output"), { recursive: true });
    await writeFile(path.join(root, "docs/design/cli.md"), "# cli");
    await writeFile(path.join(root, "docs/design/docs/docs.md"), "# docs");
    await writeFile(
      path.join(root, "packages/cli/src/output/formatter.ts"),
      "export const x = 1;",
    );
    // Bases as runDocStaleness supplies them for docs/design/docs/docs.md.
    bases = [
      root,
      path.join(root, "docs/design/docs"),
      path.join(root, "docs/design"),
    ];
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a repo-root-relative path", async () => {
    assert.equal(
      await refResolves("packages/cli/src/output/formatter.ts", {
        bases,
        suffixIndex,
      }),
      true,
    );
  });

  it("resolves a path relative to the citing document", async () => {
    // docs/design/docs/docs.md -> docs/design/cli.md
    assert.equal(await refResolves("../cli.md", { bases, suffixIndex }), true);
  });

  it("resolves a sibling design doc from the design dir", async () => {
    assert.equal(await refResolves("cli.md", { bases, suffixIndex }), true);
  });

  it("resolves a package-relative tail via the tracked-file index", async () => {
    // The regression that turned agent PRs red: correct paths, no base to
    // resolve them against.
    for (const ref of [
      "src/output/formatter.ts",
      "api/documents.ts",
      "scripts/copy-yorkie-documents.ts",
    ]) {
      assert.equal(
        await refResolves(ref, { bases, suffixIndex }),
        true,
        `expected \`${ref}\` to resolve`,
      );
    }
  });

  it("resolves a bare filename", async () => {
    assert.equal(
      await refResolves("formatter.ts", { bases, suffixIndex }),
      true,
    );
  });

  it("resolves a `./`-prefixed tail", async () => {
    assert.equal(
      await refResolves("./src/output/formatter.ts", { bases, suffixIndex }),
      true,
    );
  });

  it("resolves an ambiguous tail matching several tracked files", async () => {
    // Two tracked `documents.ts` files. Present under either reading, so it is
    // not stale — see the resolver's contract.
    assert.equal(
      await refResolves("documents.ts", { bases, suffixIndex }),
      true,
    );
  });

  it("reports a ref matching no tracked file", async () => {
    for (const ref of [
      "packages/docs/src/view/ruler.ts",
      "src/nowhere/gone.ts",
      "deleted.md",
    ]) {
      assert.equal(
        await refResolves(ref, { bases, suffixIndex }),
        false,
        `expected \`${ref}\` to be reported`,
      );
    }
  });

  it("requires the tail to start at a path boundary", async () => {
    // `legacy-api/documents.ts` is tracked; `api/documents.ts` resolves only
    // because of the real frontend file, so probe a tail that exists solely as
    // a substring of a tracked path.
    const index = buildSuffixIndex(["legacy-api/documents.ts"]);
    assert.equal(
      await refResolves("api/documents.ts", { bases, suffixIndex: index }),
      false,
    );
    assert.equal(
      await refResolves("legacy-api/documents.ts", {
        bases,
        suffixIndex: index,
      }),
      true,
    );
  });

  it("does not resolve an extension-only token", async () => {
    assert.equal(await refResolves(".test.ts", { bases, suffixIndex }), false);
  });

  it("falls back to the explicit bases when no index is available", async () => {
    // git unavailable: root-relative paths still resolve, tails cannot, and
    // nothing is spuriously reported as present.
    assert.equal(
      await refResolves("packages/cli/src/output/formatter.ts", {
        bases,
        suffixIndex: null,
      }),
      true,
    );
    assert.equal(
      await refResolves("src/output/formatter.ts", {
        bases,
        suffixIndex: null,
      }),
      false,
    );
  });
});
