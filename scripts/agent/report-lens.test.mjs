// The report pipeline's own lens directory, held to the SAME rubric contract the
// review panel enforces on its manifest.
//
// `visual-intent` deliberately does not live in `lenses/lenses.json`. It judges a
// change against a REPORTER'S SENTENCE and a baseline/actual/diff image set, and
// an ordinary frontend PR has neither — registered there it fired on every PR
// touching `packages/frontend/**` with nothing to judge, and blocked it. So it
// lives in its own directory, passed to the panel as `--lenses-dir`, which is the
// seam that already exists for exactly this.
//
// The cost of that separation is that the panel's manifest-walk guards no longer
// cover this rubric — so they are repeated here. The assertions are copies ON
// PURPOSE: they are the injection-framing and coverage-first properties, and a
// lens that reads an untrusted working tree must carry them wherever it is
// registered.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dirname, "report-lenses");
const MANIFEST = JSON.parse(readFileSync(path.join(DIR, "lenses.json"), "utf8"));

test("every rubric in the report lens dir is in its manifest, and vice versa", () => {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
  assert.deepEqual(
    MANIFEST.map((l) => l.id).sort(),
    files,
    "a rubric with no manifest row never runs; a row with no rubric crashes the panel",
  );
});

test("report lens rubrics frame their input as data, not instructions", () => {
  for (const { id } of MANIFEST) {
    const md = readFileSync(path.join(DIR, `${id}.md`), "utf8");
    assert.match(md, /as DATA/, `${id}.md lost its DATA framing`);
    assert.match(md, /never as\s+instructions/, `${id}.md lost its not-instructions framing`);
    // The lens reads the whole tree, not only the diff — and, unique to this
    // lens, a REPORTER'S SENTENCE, which is the one input a stranger writes.
    assert.ok(
      /working tree/i.test(md) || /every file you open/i.test(md),
      `${id}.md frames only the diff as DATA`,
    );
  }
});

test("report lens rubrics are coverage-first, with no certainty clamp", () => {
  for (const { id } of MANIFEST) {
    const md = readFileSync(path.join(DIR, `${id}.md`), "utf8");
    assert.match(md, /Report EVERY issue you find/, `${id}.md must instruct coverage-first`);
    assert.match(md, /[Nn]ever downgrade\s+severity/, `${id}.md must separate severity from doubt`);
    assert.match(md, /confidence/i, `${id}.md must tell the lens what confidence is for`);
  }
});

test("the report lens is not also in the shared manifest", () => {
  // Both would run it: the panel over every frontend PR, this pipeline over a
  // report. The first has no sentence and no images to judge against.
  const shared = JSON.parse(readFileSync(path.join(import.meta.dirname, "lenses", "lenses.json"), "utf8"));
  const sharedIds = new Set((Array.isArray(shared) ? shared : shared.lenses).map((l) => l.id));
  for (const { id } of MANIFEST) {
    assert.ok(!sharedIds.has(id), `${id} is registered in both manifests`);
  }
});
