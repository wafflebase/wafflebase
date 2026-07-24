// Fixer-commit filter for the review-round guard (agent-review-panel.yml's
// `fix` job). A merge commit (2 parents, e.g. a human `git merge main` to
// resolve conflicts on an iterating PR) is NOT a review-fix attempt and must
// not count toward MAX_REVIEW_ROUNDS — only genuine single-parent commits
// pushed in response to a failing lens should. PR #521 demonstrated this: 3
// single-parent fixer commits + 3 two-parent merge commits, all 6 counted by
// the old (unfiltered) logic toward the round cap.
//
// Deliberately identity-independent (no author/bot-name check): the bot
// identity behind fixer pushes has already changed once in this pipeline's
// history, so parent count — not who pushed — is the durable signal.

/** A commit is a "fixer" commit iff it has exactly one parent. */
export function isFixerCommit(commit) {
  return Array.isArray(commit?.parents) && commit.parents.length === 1;
}

/**
 * Count commits that are BOTH a fixer commit AND carry a failing required
 * lens check-run from OUR panel (exact name match + producing app, so a
 * same-named check from some other installed app can't inflate the count).
 *
 * `commits`: Array<{ sha, parents, checkRuns: Array<{name, app, conclusion}> }>
 * `requiredCheckNames`: string[]
 */
export function countFailedReviewRounds(commits, requiredCheckNames) {
  const names = new Set(requiredCheckNames ?? []);
  const isFailingLensRun = (r) =>
    names.has(r.name) && r.app?.slug === "github-actions" && r.conclusion === "failure";
  return (commits ?? []).filter(
    (c) => isFixerCommit(c) && (c.checkRuns ?? []).some(isFailingLensRun),
  ).length;
}
