// Pure check-run gate logic, shared by mark-ready.mjs and its tests.
// A required check "passes" iff its LATEST run on the SHA concluded success;
// a required check that never ran counts as NOT passed (fail closed).

/**
 * Review checks the ready gate requires when the caller passes no
 * `--require-checks` — i.e. the local preview `spec-to-pr.mjs` suggests. The
 * promotion path in agent-review-panel.yml always passes the manifest-derived
 * set, so this list cannot let a real promotion through.
 *
 * It lives here rather than in `mark-ready.mjs` for one reason: mark-ready is a
 * CLI with top-level `process.exit`, so a test cannot import it, and this is the
 * ONE lens list that does not derive itself from `lenses/lenses.json`. Adding a
 * lens and forgetting this list is a silent, invisible drift. From here
 * `checks.test.mjs` asserts it against the real manifest, so the next lens
 * cannot be added without updating it.
 */
export const DEFAULT_REVIEW_CHECKS = [
  "agent-review-correctness",
  "agent-review-security",
  "agent-review-design-fit",
  "agent-review-test-adequacy",
  "agent-review-blast-radius",
  "agent-review-docs",
];

/** Latest run of `name` concluded success? Missing → false. */
export function checkPassed(checkRuns, name) {
  const runs = (checkRuns || []).filter((r) => r.name === name);
  if (runs.length === 0) return false;
  runs.sort((a, b) => new Date(b.started_at ?? 0) - new Date(a.started_at ?? 0));
  return runs[0].conclusion === "success";
}

/** { allPassed, perCheck } for a list of required check names. */
export function allRequiredPassed(checkRuns, requiredNames) {
  const perCheck = Object.fromEntries(requiredNames.map((n) => [n, checkPassed(checkRuns, n)]));
  return { allPassed: requiredNames.every((n) => perCheck[n]), perCheck };
}
