// The mirror-import guard in `verify-pipeline-drift.mjs`, exercised as a unit.
//
// WHAT THIS GUARD IS FOR. The retained half of `scripts/agent/` must read the
// pipeline through `vendor/pipeline/`, never through the mirror. While the mirror
// still exists a stray `./severity.mjs` RESOLVES, so the mistake is invisible —
// until F2 deletes the mirror, at which point it surfaces as a runtime crash inside
// a hunt or a replay, far from the edit that caused it.
//
// THE CASE THAT MATTERS MOST cannot be observed in the live tree, because the live
// tree still has a mirror: `mirrorModules` is supplied by the caller from the
// PIPELINE REPO, not read off disk, so the guard has to keep firing once the mirror
// is gone. That is `fires after the mirror is deleted` below. Without it, the guard
// could silently become a no-op at exactly the moment it becomes load-bearing.
//
// THE IMPORT FORMS are enumerated here because the first version of this matcher
// only understood `from "…"` with double quotes. Side-effect imports, single quotes,
// re-exports, and a bare `vendor/…` specifier all read as clean to it. None of those
// forms appears in the tree today, which is precisely why a regression test has to
// carry them: the next person to write one gets no warning from the current corpus.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { mirrorImports, reappearedMirrorFiles, readPins, stalePipelinePaths } from "../verify-pipeline-drift.mjs";

// Stands in for the 34 files the pipeline repo owns. `lens_v2.mjs` is deliberately
// shaped so the original `[a-z-]+` pattern could not have matched it.
const MIRROR = new Set([
  "severity.mjs",
  "review-panel.mjs",
  "gh-checks.mjs",
  "rounds.test.mjs",
  "lens_v2.mjs",
]);

/** Build a throwaway `scripts/agent`-shaped tree and run the guard over it. */
function check(files, mirror = MIRROR) {
  const root = mkdtempSync(path.join(tmpdir(), "drift-guard-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return mirrorImports(root, mirror);
}

test("flags a double-quoted mirror import", () => {
  const bad = check({ "harvest.mjs": 'import { KNOWN } from "./severity.mjs";\n' });
  assert.deepEqual(bad, ["harvest.mjs imports ./severity.mjs"]);
});

test("flags a side-effect import", () => {
  const bad = check({ "harvest.mjs": 'import "./severity.mjs";\n' });
  assert.deepEqual(bad, ["harvest.mjs imports ./severity.mjs"]);
});

test("flags a single-quoted import", () => {
  const bad = check({ "harvest.mjs": "import { KNOWN } from './severity.mjs';\n" });
  assert.deepEqual(bad, ["harvest.mjs imports ./severity.mjs"]);
});

test("flags a dynamic import()", () => {
  const bad = check({ "harvest.mjs": 'const m = await import("./severity.mjs");\n' });
  assert.deepEqual(bad, ["harvest.mjs imports ./severity.mjs"]);
});

test("flags a re-export, which is an import edge too", () => {
  const bad = check({ "harvest.mjs": 'export { KNOWN } from "./severity.mjs";\n' });
  assert.deepEqual(bad, ["harvest.mjs imports ./severity.mjs"]);
});

test("flags a mirror module a shape-matching pattern would miss", () => {
  // `lens_v2` has an underscore and a digit; the original `([a-z-]+)\.mjs` could not
  // match it, so the guard would have passed a genuinely broken import.
  const bad = check({ "harvest.mjs": 'import x from "./lens_v2.mjs";\n' });
  assert.deepEqual(bad, ["harvest.mjs imports ./lens_v2.mjs"]);
});

test("flags a bare vendor/ specifier as the package specifier it is", () => {
  // The bug that cost two attempts at C2: Node reads `vendor/…` as a PACKAGE name,
  // so it fails with "Cannot find package 'vendor'" only at runtime.
  const bad = check({ "harvest.mjs": 'import x from "vendor/pipeline/severity.mjs";\n' });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /bare specifier/);
});

test("accepts ./vendor/pipeline/ — the correct target", () => {
  assert.deepEqual(check({ "harvest.mjs": 'import x from "./vendor/pipeline/severity.mjs";\n' }), []);
});

test("accepts ../vendor/pipeline/ from a subdirectory", () => {
  assert.deepEqual(check({ "eval/run.mjs": 'import x from "../vendor/pipeline/severity.mjs";\n' }), []);
});

test("resolves ../ out of a subdirectory back to the mirror", () => {
  const bad = check({ "eval/run.mjs": 'import x from "../severity.mjs";\n' });
  assert.deepEqual(bad, ["eval/run.mjs imports ../severity.mjs"]);
});

test("does not confuse a same-named file inside a subdirectory", () => {
  // `./severity.mjs` from within eval/ is `eval/severity.mjs`, a retained file that
  // merely shares a basename with a mirror module. Matching on the basename alone
  // would report this, and the report would be wrong.
  assert.deepEqual(check({ "eval/thing.mjs": 'import x from "./severity.mjs";\n' }), []);
});

test("ignores builtins and package specifiers", () => {
  const bad = check({
    "harvest.mjs": 'import fs from "node:fs";\nimport z from "zod";\nimport t from "@wafflebase/core";\n',
  });
  assert.deepEqual(bad, []);
});

test("exempts the mirror's own files and their tests", () => {
  // A mirror file importing its own sibling is correct and must not change: it is
  // byte-compared against the pinned commit instead.
  const bad = check({
    "review-panel.mjs": 'import { KNOWN } from "./severity.mjs";\n',
    "rounds.test.mjs": 'import x from "./severity.mjs";\n',
  });
  assert.deepEqual(bad, []);
});

test("skips node_modules and vendor trees", () => {
  const bad = check({
    "node_modules/pkg/index.mjs": 'import x from "./severity.mjs";\n',
    "vendor/pipeline/rounds.mjs": 'import x from "./severity.mjs";\n',
  });
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------------------
// The mirror must stay deleted. This replaced the byte-comparison, which had
// nothing left to compare once F2 removed the copy.
// ---------------------------------------------------------------------------

/** Build a throwaway tree and ask which files the pipeline repo owns. */
function reappeared(files, owned) {
  const root = mkdtempSync(path.join(tmpdir(), "drift-grow-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return reappearedMirrorFiles(root, new Set(owned));
}

test("reports a pipeline file that has come back", () => {
  assert.deepEqual(reappeared({ "severity.mjs": "" }, ["severity.mjs"]), ["severity.mjs"]);
});

test("does NOT report the vendored copy", () => {
  // The trap: vendor/pipeline/ holds those same files by design, and reporting them
  // would tell people to delete the thing they are supposed to use.
  //
  // Two independent things prevent it — `vendor/` is in STAYS so `walk` never
  // descends, and the comparison is by full relative path so `vendor/pipeline/x.mjs`
  // would not equal `x.mjs` anyway. Mutation-tested: this fails only when BOTH are
  // removed, so read it as pinning the property, not either mechanism.
  assert.deepEqual(reappeared({ "vendor/pipeline/severity.mjs": "" }, ["severity.mjs"]), []);
});

test("does NOT report measurement files", () => {
  assert.deepEqual(
    reappeared({ "harvest.mjs": "", "eval/run.mjs": "", "hunt-gate.mjs": "" }, ["harvest.mjs", "eval/run.mjs"]),
    [],
  );
});

test("does NOT report package.json, which outlived the mirror", () => {
  // It declares what the RETAINED half needs — the hunters `await import` the SDK
  // and eval/run.test.mjs reads the pinned version out of it — so it stays and is
  // free to diverge from the pipeline's own manifest.
  assert.deepEqual(reappeared({ "package.json": "{}" }, ["package.json"]), []);
});

test("fires after the mirror is deleted", () => {
  // F2 removes the mirror from disk. `mirrorModules` comes from the pipeline repo,
  // so a retained file that still points at a deleted sibling must still be caught —
  // this is the case the guard exists for, and the one the live tree cannot show.
  const bad = check({
    "harvest.mjs": 'import { KNOWN } from "./severity.mjs";\n',
    "eval/run.mjs": 'import { classifyFile } from "../review-panel.mjs";\n',
  });
  assert.deepEqual(bad.sort(), [
    "eval/run.mjs imports ../review-panel.mjs",
    "harvest.mjs imports ./severity.mjs",
  ]);
});

// ---------------------------------------------------------------------------
// Paths BUILT as strings. The import check is blind to these, and they are the
// worse failure: an import breaks at load, a built path breaks when it is used,
// and a fail-quiet reader turns it into wrong data rather than an error.
// ---------------------------------------------------------------------------

/** Build a throwaway tree and ask which files name a pipeline path outside vendor/. */
function stale(files, owned) {
  const root = mkdtempSync(path.join(tmpdir(), "drift-paths-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return stalePipelinePaths(root, new Set(owned));
}

test("flags a path built to a deleted pipeline file", () => {
  const bad = stale(
    { "harvest.mjs": 'const P = path.join(HERE, "lenses", "lenses.json");\n' },
    ["lenses/lenses.json"],
  );
  assert.deepEqual(bad, ["harvest.mjs builds a path to lenses"]);
});

test("flags one built with a parent hop", () => {
  const bad = stale(
    { "eval/run.mjs": 'export const P = path.join(HERE, "..", "review-panel.mjs");\n' },
    ["review-panel.mjs"],
  );
  assert.deepEqual(bad, ["eval/run.mjs builds a path to review-panel.mjs"]);
});

test("accepts the vendored form", () => {
  assert.deepEqual(
    stale({ "harvest.mjs": 'path.join(HERE, "vendor", "pipeline", "lenses", "lenses.json");\n' }, ["lenses/lenses.json"]),
    [],
  );
});

test("does NOT flag a path into a temp directory that happens to share a name", () => {
  // The precision this check lives or dies by: `path.join(work, "lenses")` is a
  // materialised fixture, not a reference to this repo's tree. Anchoring on HERE is
  // what separates them — a basename match would report every replay harness.
  assert.deepEqual(
    stale({ "eval/adapters/reviewer.test.mjs": 'const d = path.join(work, "lenses");\n' }, ["lenses/lenses.json"]),
    [],
  );
});

test("ignores paths to things the pipeline does not own", () => {
  assert.deepEqual(stale({ "harvest.mjs": 'path.join(HERE, "misses.jsonl");\n' }, ["lenses/lenses.json"]), []);
});

// ---------------------------------------------------------------------------
// readPins. A ref that is not a full sha used to be dropped on the floor, which
// made a mutable `ref: main` invisible here while still satisfying "all pins
// agree" — the invariant the deleted scripts/agent/checks.test.mjs guarded.
// ---------------------------------------------------------------------------

/** Write throwaway workflows and read their pins. */
function pins(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "drift-pins-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return readPins(dir);
}

const SHA = "a".repeat(40);
const checkout = (ref) => `      - uses: actions/checkout@v4\n        with:\n          repository: wafflebase/agent-pipeline\n          ref: ${ref}\n`;

test("readPins collects a full sha and reports where", () => {
  const { pins: p, loose } = pins({ "agent-a.yml": checkout(SHA) });
  assert.deepEqual(loose, []);
  assert.deepEqual([...p.keys()], [SHA]);
  assert.match(p.get(SHA)[0], /^agent-a\.yml:\d+$/);
});

test("readPins REFUSES to silently drop a tag or branch pin", () => {
  for (const ref of ["main", "v0.3.1", "refs/tags/v0.3.1", "a".repeat(39)]) {
    const { pins: p, loose } = pins({ "agent-a.yml": checkout(ref) });
    assert.deepEqual([...p.keys()], [], `${ref} must not be read as a pinned commit`);
    assert.equal(loose.length, 1, `${ref} must be reported, not dropped`);
    assert.match(loose[0], /agent-a\.yml/);
  }
});

test("readPins reports a loose ref even when another workflow is pinned", () => {
  // The shape that made this dangerous: one sha-pinned site is enough for
  // "all workflows agree on one commit" to hold while another runs a moving ref.
  const { pins: p, loose } = pins({ "agent-a.yml": checkout(SHA), "agent-b.yml": checkout("main") });
  assert.deepEqual([...p.keys()], [SHA], "the sha-pinned site still resolves");
  assert.equal(loose.length, 1, "and the moving ref is still reported");
});

test("readPins reports a checkout with no ref at all", () => {
  const { loose } = pins({
    "agent-a.yml": "      - uses: actions/checkout@v4\n        with:\n          repository: wafflebase/agent-pipeline\n",
  });
  assert.equal(loose.length, 1);
  assert.match(loose[0], /no ref: at all/);
});

test("readPins ignores non-agent workflows and other repositories", () => {
  const { pins: p, loose } = pins({
    "ci.yml": checkout(SHA),
    "agent-a.yml": "      - uses: actions/checkout@v4\n        with:\n          repository: some/other\n          ref: main\n",
  });
  assert.deepEqual([...p.keys()], []);
  assert.deepEqual(loose, []);
});
