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
    "packages/README.md": "- [`sheets`](sheets/README.md)\n",
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

  await t.test("strips fragments and titles", () => {
    const targets = linkedTargets('[a](foo.md#head) [b](bar.md "Bar")');
    assert.deepEqual([...targets], ["foo.md", "bar.md"]);
  });
});

test("a tree where every index is complete has no findings", () => {
  assert.deepEqual(findingsFor(passingTree()), []);
});

test("packages", async (t) => {
  await t.test("an unlinked package is reported", () => {
    const findings = findingsFor(
      passingTree({ "packages/board/package.json": "{}\n" }),
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0], /packages\/board/);
    assert.match(findings[0], /packages\/README\.md/);
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

  await t.test("a substring of a longer name does not count", () => {
    // `verify-integration.mjs` mentioned must not satisfy
    // `verify-integration-docker.mjs`, which contains it as a prefix.
    const files = passingTree({
      "scripts/verify-integration.mjs": "",
      "scripts/verify-integration-docker.mjs": "",
    });
    files["scripts/README.md"] += "| `verify-integration-docker.mjs` | x |\n";
    const findings = findingsFor(files);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /verify-integration\.mjs/);
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
