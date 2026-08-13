// The index-coverage gate, checked as a pure function over a fixture tree.
//
// Every case below plants a real directory tree in a temp dir and runs the
// checks against it, rather than against this repository — so a case can assert
// that a MISSING entry is caught, which is the only direction that matters and
// the one a self-check against a passing repo can never exercise.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectFindings, linkedTargets } from "../verify-doc-index.mjs";

function makeTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "doc-index-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

/** The smallest tree that passes every check. Cases mutate a copy of it. */
function passingTree(extra = {}) {
  return {
    "README.md": "- [packages/sheets/](packages/sheets/README.md)\n",
    "packages/README.md": "- [`sheets`](sheets/README.md)\n",
    "packages/sheets/README.md": "# Sheets\n",
    "packages/sheets/package.json": "{}\n",
    "docs/design/README.md": "- [sheet.md](sheets/sheet.md)\n",
    "docs/design/sheets/sheet.md": "# Sheet\n",
    "scripts/README.md": "| `verify-self.mjs` | the runner |\n",
    "scripts/verify-self.mjs": "// runner\n",
    ...extra,
  };
}

function findingsFor(files) {
  const root = makeTree(files);
  try {
    return collectFindings(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("linkedTargets", async (t) => {
  await t.test("reads markdown link targets", () => {
    const targets = linkedTargets("see [a](foo/bar.md) and [b](baz/)");
    assert.deepEqual([...targets], ["foo/bar.md", "baz/"]);
  });

  await t.test("ignores external links and bare anchors", () => {
    const targets = linkedTargets("[x](https://example.com) [y](#section)");
    assert.deepEqual([...targets], []);
  });

  await t.test("ignores links inside fenced code blocks", () => {
    // A fenced example of what an index row looks like is documentation, not a
    // link — counting it would let a doc satisfy the gate by describing itself.
    const targets = linkedTargets("```\n[a](foo/bar.md)\n```\n[b](real.md)");
    assert.deepEqual([...targets], ["real.md"]);
  });

  await t.test("recognizes tilde fences, and nests them correctly", () => {
    assert.deepEqual([...linkedTargets("~~~\n[a](x.md)\n~~~\n[b](y.md)")], [
      "y.md",
    ]);
    // A ``` inside a ~~~ block does not close it.
    assert.deepEqual([...linkedTargets("~~~\n```\n[a](x.md)\n~~~\n[b](y.md)")], [
      "y.md",
    ]);
  });

  await t.test("ignores image embeds", () => {
    // `![alt](shot.png)` is not a claim that the directory holding the image
    // has been introduced to the reader.
    assert.deepEqual([...linkedTargets("![alt](img/shot.png) [b](real.md)")], [
      "real.md",
    ]);
  });

  await t.test("strips fragments and titles", () => {
    const targets = linkedTargets('[a](foo.md#head) [b](bar.md "Bar")');
    assert.deepEqual([...targets], ["foo.md", "bar.md"]);
  });
});

test("a tree where every index is complete has no findings", () => {
  assert.deepEqual(findingsFor(passingTree()), []);
});

test("packages", async (t) => {
  await t.test("an unlinked package is reported by both indexes", () => {
    // The root README duplicates the list on purpose, so both must be checked;
    // gating only one leaves the other as the copy that rots silently.
    const findings = findingsFor(
      passingTree({ "packages/board/package.json": "{}\n" }),
    );
    assert.equal(findings.length, 2);
    assert.ok(findings.every((f) => /packages\/board/.test(f)));
    assert.ok(findings.some((f) => f.startsWith("packages/README.md")));
    assert.ok(findings.some((f) => f.startsWith("README.md")));
  });

  await t.test("a package listed in only one of the two indexes is reported", () => {
    const files = passingTree({ "packages/board/package.json": "{}\n" });
    files["packages/README.md"] += "- [`board`](board/)\n";
    const findings = findingsFor(files);
    assert.equal(findings.length, 1);
    assert.ok(findings[0].startsWith("README.md"));
  });

  await t.test("a link to a path that does not exist grants no coverage", () => {
    // `isLinkedInto` is a string-prefix test, so a typo'd row would otherwise
    // introduce the package as far as the gate can tell — and nothing else
    // dead-link checks this index.
    const files = passingTree({ "packages/board/package.json": "{}\n" });
    files["packages/README.md"] += "- [`board`](board/TYPO.md)\n";
    files["README.md"] += "- [board](packages/board/TYPO.md)\n";
    const findings = findingsFor(files);
    assert.equal(findings.length, 2);
  });

  await t.test("a directory without a package.json is not a package", () => {
    // `packages/node_modules` and stray build output must not be demanded.
    const findings = findingsFor(
      passingTree({ "packages/node_modules/x/index.js": "" }),
    );
    assert.deepEqual(findings, []);
  });

  await t.test("a link through the package's own directory counts", () => {
    const files = passingTree({ "packages/board/package.json": "{}\n" });
    files["packages/README.md"] += "- [`board`](board/)\n";
    files["README.md"] += "- [board](packages/board/)\n";
    assert.deepEqual(findingsFor(files), []);
  });
});

test("design docs", async (t) => {
  await t.test("an unlinked design doc is reported", () => {
    const findings = findingsFor(
      passingTree({ "docs/design/slides/slides.md": "# Slides\n" }),
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0], /slides\/slides\.md/);
  });

  await t.test("a linked ancestor directory covers the files beneath it", () => {
    // This is what keeps an umbrella row legal: `docs/design/README.md` links
    // `docs/tables/` once and the per-feature docs under it are covered,
    // without an exception list that would rot.
    const files = passingTree({
      "docs/design/docs/tables/nested.md": "# Nested\n",
      "docs/design/docs/tables/resize.md": "# Resize\n",
    });
    files["docs/design/README.md"] += "- [tables](docs/tables/)\n";
    assert.deepEqual(findingsFor(files), []);
  });

  await t.test("the index itself is never demanded of itself", () => {
    assert.deepEqual(findingsFor(passingTree()), []);
  });

  await t.test("a link to the index's own directory covers nothing", () => {
    // The hole this closes: `./` resolves to `docs/design`, an ancestor of
    // every design doc, so one self-referential link would take the whole
    // check green with zero real coverage — silently, in the gate whose job is
    // noticing silence.
    const files = passingTree({ "docs/design/slides/slides.md": "# Slides\n" });
    files["docs/design/README.md"] += "- [all design docs](./)\n";
    const findings = findingsFor(files);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /slides\/slides\.md/);
  });

  await t.test("a link above the index's own directory covers nothing", () => {
    const files = passingTree({ "docs/design/slides/slides.md": "# Slides\n" });
    files["docs/design/README.md"] += "- [docs](../)\n";
    assert.equal(findingsFor(files).length, 1);
  });

  await t.test("a nested README is covered by its own directory link", () => {
    const files = passingTree({ "docs/design/board/README.md": "# Board\n" });
    files["docs/design/README.md"] += "- [board](board/)\n";
    assert.deepEqual(findingsFor(files), []);
  });
});

test("scripts", async (t) => {
  await t.test("an unmentioned top-level script is reported", () => {
    const findings = findingsFor(
      passingTree({ "scripts/verify-entropy.mjs": "// gate\n" }),
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0], /verify-entropy\.mjs/);
  });

  await t.test("an unmentioned subdirectory is reported", () => {
    const findings = findingsFor(passingTree({ "scripts/agent/run.mjs": "" }));
    assert.equal(findings.length, 1);
    assert.match(findings[0], /agent/);
  });

  await t.test("files nested inside a subdirectory are not demanded", () => {
    // `scripts/agent/` alone holds over a hundred files. The gate covers the
    // top level; enumerating a subtree would be noise nobody maintains.
    const files = passingTree({
      "scripts/agent/run.mjs": "",
      "scripts/agent/deep/nested.mjs": "",
    });
    files["scripts/README.md"] += "| [`agent/`](agent/) | pipeline |\n";
    assert.deepEqual(findingsFor(files), []);
  });

  await t.test("a bare mention counts — scripts need no link", () => {
    // The scripts index is a table of names, not of links.
    const files = passingTree({ "scripts/tasks-index.mjs": "" });
    files["scripts/README.md"] += "| `tasks-index.mjs` | reindexes |\n";
    assert.deepEqual(findingsFor(files), []);
  });

  await t.test("a directory name occurring inside another name does not count", () => {
    // The real boundary case, and it is live in this repository: directories
    // are matched without an extension to terminate them, and `test` occurs
    // inside `run-browser-tests-docker.sh`. Under a plain `includes` that one
    // row would exempt `scripts/test/` entirely. This case fails without the
    // word-boundary match.
    const files = passingTree({
      "scripts/run-browser-tests-docker.sh": "",
      "scripts/test/some.test.mjs": "",
    });
    files["scripts/README.md"] += "| `run-browser-tests-docker.sh` | x |\n";
    const findings = findingsFor(files);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /`test\/`/);
  });

  await t.test("a mention inside a fenced block does not count", () => {
    // Same rule as `linkedTargets`: a fenced `ls scripts/` dump names every
    // entry without introducing any of them.
    const files = passingTree({ "scripts/tasks-index.mjs": "" });
    files["scripts/README.md"] += "```\nls scripts/\ntasks-index.mjs\n```\n";
    const findings = findingsFor(files);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /tasks-index\.mjs/);
  });

  await t.test("dotfiles are ignored", () => {
    assert.deepEqual(findingsFor(passingTree({ "scripts/hooks/.gitkeep": "" })), [
      // `.gitkeep` is skipped, but `hooks/` itself is still a real directory.
      "scripts/README.md does not mention `hooks/`",
    ]);
  });
});

test("a missing index file is a finding, not a crash", () => {
  const files = passingTree();
  delete files["scripts/README.md"];
  const findings = findingsFor(files);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /scripts\/README\.md is missing/);
});
