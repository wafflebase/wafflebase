// The vendored-copy integrity checker in `scripts/vendor-pipeline.mjs`.
//
// This script had no tests at all while it grew three behaviours that decide whether
// a wrong vendored copy is caught: recursion into subdirectories (the lens rubrics
// live in one), an import matcher that has to see every form, and closure checked by
// RESOLVED path rather than by basename.
//
// The basename bug is the one worth a regression test even though it cannot fire
// today: nothing nested is vendored, so `./lenses/b.mjs` being satisfied by a root
// `b.mjs` is latent — and a check that only holds while the set stays flat stops
// holding silently the moment someone adds a subdirectory.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assertClosed, walkVendor } from "../vendor-pipeline.mjs";

/** Build a throwaway vendor tree. */
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "vendor-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

/** assertClosed, with the failure captured instead of exiting the process. */
function closure(files, listed) {
  const root = tree(files);
  let reported = null;
  assertClosed(root, listed, (...lines) => { reported = lines.join("\n"); });
  return reported;
}

test("walkVendor descends into subdirectories", () => {
  // The flat readdirSync this replaced could not see the lens rubrics at all, so an
  // unlisted file under lenses/ would have been invisible to the verifier.
  const root = tree({ "ask.mjs": "", "lenses/docs.md": "", "lenses/lenses.json": "" });
  assert.deepEqual(walkVendor(root).sort(), ["ask.mjs", "lenses/docs.md", "lenses/lenses.json"]);
});

test("a closed set reports nothing", () => {
  assert.equal(
    closure({ "a.mjs": 'import x from "./b.mjs";\n', "b.mjs": "" }, ["a.mjs", "b.mjs"]),
    null,
  );
});

test("an unresolved import is reported", () => {
  const r = closure({ "a.mjs": 'import x from "./missing.mjs";\n' }, ["a.mjs"]);
  assert.match(r, /not closed/);
  assert.match(r, /a\.mjs imports \.\/missing\.mjs/);
});

test("closure is judged by RESOLVED path, not by basename", () => {
  // `lenses/a.mjs` importing `./b.mjs` needs `lenses/b.mjs`. A basename comparison
  // would accept the root `b.mjs` and the vendored set would ship broken.
  const r = closure(
    { "b.mjs": "", "lenses/a.mjs": 'import x from "./b.mjs";\n' },
    ["b.mjs", "lenses/a.mjs"],
  );
  assert.match(r, /lenses\/a\.mjs imports \.\/b\.mjs/);
});

test("a parent hop out of a subdirectory resolves", () => {
  assert.equal(
    closure({ "b.mjs": "", "lenses/a.mjs": 'import x from "../b.mjs";\n' }, ["b.mjs", "lenses/a.mjs"]),
    null,
  );
});

test("every import form is seen, in either quote style", () => {
  // The matcher used to understand only double-quoted `from`/`import()`, so an
  // unclosed side-effect or single-quoted import passed here and failed at runtime.
  for (const form of [
    'import "./missing.mjs";',
    "import x from './missing.mjs';",
    'const m = await import("./missing.mjs");',
    'export { y } from "./missing.mjs";',
  ]) {
    const r = closure({ "a.mjs": `${form}\n` }, ["a.mjs"]);
    assert.match(r ?? "", /a\.mjs imports \.\/missing\.mjs/, `not detected: ${form}`);
  }
});

test("builtins and package specifiers are not closure members", () => {
  assert.equal(
    closure({ "a.mjs": 'import fs from "node:fs";\nimport z from "zod";\n' }, ["a.mjs"]),
    null,
  );
});
