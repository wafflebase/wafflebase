import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPassed, allRequiredPassed, DEFAULT_REVIEW_CHECKS } from "./checks.mjs";

// `DEFAULT_REVIEW_CHECKS` is the ONE lens list in the repo that does not derive
// itself from lenses.json, so it is the one that silently rots when a lens is
// added. Assert it against the REAL manifest — this test is the reason the
// constant lives in checks.mjs at all (mark-ready.mjs is a CLI with top-level
// process.exit and cannot be imported).
test("DEFAULT_REVIEW_CHECKS covers every ALWAYS-APPLICABLE blocking lens", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const lenses = JSON.parse(readFileSync(path.join(HERE, "lenses", "lenses.json"), "utf8"));
  const isBlocking = (l) => String(l.gating ?? "blocking") === "blocking";
  const alwaysOn = (l) => {
    const g = l.appliesWhen ?? ["**"];
    return g.length === 0 || g.includes("**");
  };
  // This used to require EVERY blocking lens, which made the default gate
  // unsatisfiable for any PR that legitimately skipped a path-scoped one: a
  // skipped lens posts `neutral`, and checkPassed only accepts `success`. So a
  // docs-only PR could never satisfy agent-review-test-adequacy, and once a
  // `docs` lens existed, a code-only PR could never satisfy agent-review-docs
  // either. Only the always-on lenses belong here.
  assert.deepEqual(
    [...DEFAULT_REVIEW_CHECKS].sort(),
    lenses.filter((l) => isBlocking(l) && alwaysOn(l)).map((l) => `agent-review-${l.id}`).sort(),
    "DEFAULT_REVIEW_CHECKS must list exactly the blocking lenses whose appliesWhen is '**'",
  );
  // A path-scoped lens here would reintroduce the unsatisfiable-gate bug.
  for (const l of lenses.filter((x) => isBlocking(x) && !alwaysOn(x))) {
    assert.ok(
      !DEFAULT_REVIEW_CHECKS.includes(`agent-review-${l.id}`),
      `path-scoped lens ${l.id} must not be a default required check — it is neutral whenever it does not apply`,
    );
  }
  assert.ok(DEFAULT_REVIEW_CHECKS.length > 0, "mark-ready fails closed on an empty required set");
  // Advisory lenses must NOT be required — the ready gate would wait forever on
  // a check that is posted as `neutral` and never `success`.
  for (const l of lenses.filter((x) => String(x.gating ?? "blocking") !== "blocking")) {
    assert.ok(
      !DEFAULT_REVIEW_CHECKS.includes(`agent-review-${l.id}`),
      `advisory lens ${l.id} must not be a required default check`,
    );
  }
});

const succ = (name, t = "2026-07-21T10:00:00Z") => ({ name, conclusion: "success", started_at: t });
const fail = (name, t = "2026-07-21T10:00:00Z") => ({ name, conclusion: "failure", started_at: t });

test("checkPassed: missing check → false; latest run wins", () => {
  assert.equal(checkPassed([], "a"), false);
  assert.equal(checkPassed([succ("a")], "a"), true);
  assert.equal(checkPassed([fail("a")], "a"), false);
  // fail then success (newer) → passed
  assert.equal(checkPassed([fail("a", "2026-07-21T10:00:00Z"), succ("a", "2026-07-21T11:00:00Z")], "a"), true);
  // success then fail (newer) → not passed
  assert.equal(checkPassed([succ("a", "2026-07-21T10:00:00Z"), fail("a", "2026-07-21T11:00:00Z")], "a"), false);
});

test("allRequiredPassed: all present+success → pass; any failing or MISSING → block", () => {
  const req = ["x", "y", "z"];
  assert.equal(allRequiredPassed([succ("x"), succ("y"), succ("z")], req).allPassed, true);
  assert.equal(allRequiredPassed([succ("x"), fail("y"), succ("z")], req).allPassed, false);
  // partial set: 'z' never posted → block
  const partial = allRequiredPassed([succ("x"), succ("y")], req);
  assert.equal(partial.allPassed, false);
  assert.equal(partial.perCheck.z, false);
});

test("allRequiredPassed: an EMPTY required set is vacuously true", () => {
  // `[].every` is true, so a required set of [] "passes" with ZERO evidence.
  // This is the fail-open mark-ready.mjs guards against: it refuses to promote
  // on an empty required-check set unless --allow-no-checks is passed.
  assert.equal(allRequiredPassed([], []).allPassed, true);
  assert.equal(allRequiredPassed([fail("x")], []).allPassed, true);
});
