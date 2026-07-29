// Pure check-run gate logic, shared by mark-ready.mjs and its tests.
// A required check "passes" iff its LATEST run on the SHA concluded success;
// a required check that never ran counts as NOT passed (fail closed).

/**
 * Review checks the ready gate requires when the caller passes no
 * `--require-checks` — i.e. the local preview `spec-to-pr.mjs` suggests. The
 * promotion path in agent-review-panel.yml always passes the manifest-derived
 * `blocking && applicable` set, so this list cannot let a real promotion through.
 *
 * It holds only the blocking lenses that apply to EVERY diff (`appliesWhen` of
 * `**`). This caller has no panel output, so it cannot know which lenses were
 * applicable, and `checkPassed` counts a `neutral` (skipped) check as NOT
 * passed — so a path-scoped lens listed here makes the gate unsatisfiable for
 * every PR that legitimately skips it (test-adequacy on a docs-only PR, docs on
 * a code-only PR). Requiring the always-on lenses keeps the fallback meaningful
 * while staying satisfiable on ordinary code PRs (mark-ready still fails closed
 * on an empty set).
 *
 * KNOWN GAP, pre-dating file-class routing and not fixed here: "always
 * applicable" is not the same as "always has something to review". A lens can
 * apply and still be skipped when nothing in its `scopeClasses` changed, so a
 * prose-only PR skips correctness and this default gate cannot be satisfied.
 * The same hole existed before routing (test-adequacy on a docs-only PR). The
 * real promotion path is unaffected — agent-review-panel.yml always passes the
 * manifest-derived `blocking && applicable` set. Fixing it properly means
 * teaching this path that a neutral required check is a skip rather than a
 * failure, which is a change to the gate's semantics, not to this list.
 *
 * It lives here rather than in `mark-ready.mjs` for one reason: mark-ready is a
 * CLI with top-level `process.exit`, so a test cannot import it, and this is the
 * ONE lens list that does not derive itself from `lenses/lenses.json`. Drift is
 * silent, so `checks.test.mjs` asserts it against the real manifest.
 */
export const DEFAULT_REVIEW_CHECKS = [
  "agent-review-correctness",
  "agent-review-security",
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
