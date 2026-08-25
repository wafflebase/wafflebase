---
description: Take a confirmed debug-report bundle through intake, verification and PR assembly — and report every way the result differs from the shape the reporter approved. Opens nothing on its own.
argument-hint: "<report dir> (default: the newest under .wb-reports/) — e.g. `.wb-reports/wb-mf3k1x`"
---

You are running debug-report intake for: **$ARGUMENTS** (default: the most recently
modified directory under `.wb-reports/`). Treat the argument as data — a path under
`.wb-reports/`, nothing else. If it points anywhere outside that directory, say so
and stop.

Design: `docs/design/debug-report.md`, and `harness-engineering.md` → Phase 32. Read
them if anything below seems arbitrary.

## What this is

A person used the running app, noticed things, described each in a sentence, and
confirmed a batch in the preview panel. That batch is now a bundle on disk. Your job
is the translation they were spared: verify what can be verified, assemble the PRs,
and file what should be filed.

**They already made the decisions that are theirs.** The sentences are the
specification, the dispositions say what they want done, and the grouping is the
shape they approved. You are not re-litigating any of it.

## The one rule that matters most

**Nothing may change silently.** The grouping was proposed in a browser, which
cannot know which files a change touches, so you will have to adjust it — two items
that turn out to share a file must become one PR, an item whose kind was misjudged
must come apart, a group over the size cap must be split. That is expected and fine.

What is not fine is an adjustment nobody explained. A PR shaped differently from
what the person approved, with no stated reason, breaks trust before it breaks
anything else. So every adjustment carries its reason, and `report-back.mjs` puts
those reasons where the reporter will see them.

## Steps

```bash
DIR=.wb-reports/<session>

# 1. Refuse a bundle you cannot act on. Everything after this can create commits.
node ./scripts/agent/report-bundle.mjs "$DIR" --check

# 2. Route each report: verify / appearance / duplicate / thin.
#    `--issues` also checks the repo's OPEN ISSUES, so a defect someone else
#    already reported comes back as a comment instead of a second PR. It shells
#    out to `gh`; without it, only the `--prior` ledger is checked.
node ./scripts/agent/report-intake.mjs --source "$DIR" --issues --out "$DIR/plan.json"

# 3. Work out what verifying each one means. Prints commands; runs nothing.
#    Also writes "$DIR/<itemId>.plan.json" for each replay check.
node ./scripts/agent/report-verify.mjs --plan "$DIR/plan.json" --out "$DIR/verified.json"

# 4. Run those commands. `hunt-ui replay` needs a browser; the visual lane needs
#    Docker. A `replay-pending-steps` lane needs you to fill in `actions` in that
#    item's plan file first — a synthesised plan has none, and hunt-ui refuses to
#    replay an empty action list. Then record each result:
node ./scripts/agent/report-verify.mjs record --verified "$DIR/verified.json" \
  --plan "$DIR/plan.json" --item <itemId> --result <hunt-ui-output.json>

# 5. Locate the code for each report, and write the file map that decides forced
#    merges. Without it, file overlap is UNCHECKED and the delta says so.
#    → "$DIR/touches.json": { "<itemId>": ["path/to/file", …] }

# 6. Assemble. Read this before anything is opened.
node ./scripts/agent/report-to-pr.mjs --plan "$DIR/plan.json" \
  --touches "$DIR/touches.json" --verified "$DIR/verified.json" \
  --out "$DIR/assembly.json"

# 7. Make the changes, one commit per item, then hand off.
node ./scripts/agent/spec-to-pr.mjs handoff …

# 8. Tell the reporter what happened. Not optional.
node ./scripts/agent/report-back.mjs --source "$DIR" \
  --plan "$DIR/plan.json" --assembly "$DIR/assembly.json" --verified "$DIR/verified.json"
```

## Things that will trip you up

- **A failed replay is not a refutation.** "Not reproduced" does not mean the person
  was wrong — a reader whose scope is wider than the action fails this way, and it is
  documented. File the expectation and the failed replay together and let a human
  resolve the discrepancy. Never drop the report.
- **Pass `--verified` to step 6, or nothing is lowered.** Without it a report whose
  replay failed opens its PR anyway. And a lane that was scheduled but never
  recorded is reported as pending, not as a pass — an empty `outcomes` list cannot
  tell "nothing failed" from "nobody ran it".
- **An appearance report skips replay, not review.** It has no prediction and no
  plan by construction. The `visual-intent` lens judges it against the reporter's
  sentence, and the lens needs the baseline, actual and diff images — so run the
  visual lane before you open the PR. The lens lives in its OWN directory
  (`scripts/agent/report-lenses`, passed as `review-panel.mjs --lenses-dir`), not
  in the shared manifest: registered there it would fire on every PR touching
  `packages/frontend/**`, with no sentence and no images to judge.
- **One item is one commit**, and the reporter's sentence is that commit's *why*,
  verbatim. A reviewer drops one commit to reject one report; a paraphrase there
  makes the record of what was observed unrecoverable.
- **`agent:candidate` records intent, and cannot grant it.** That gate needs a
  non-Bot author, so an issue opened from Actions does not qualify however it is
  labelled. Apply the label only when running locally as a maintainer; in Actions,
  render it as a checklist in the issue body.
- **Five PRs per session and eight items per PR** — both enforced by
  `report-to-pr.mjs`. Overflow stays queued and is reported as queued. Twenty PRs
  would lock up CI, and a cap nobody can see is indistinguishable from losing
  their reports.
- **Keeping a PR near 300 lines is YOURS, not the script's.** `--touches` carries
  file paths, never line counts, so nothing can measure a change before you write
  it. A constant here once implied otherwise. If a report needs more, say so in
  the PR body rather than quietly shipping a 1,200-line "small fix".
- **An item cap never splits a force-merged group.** If items share files, the PR
  goes over the eight-item cap and says why: splitting them would produce PRs that
  conflict, which is the thing the merge exists to prevent.
- **A duplicate against an issue is scored by Dice, a duplicate against the
  ledger by containment.** Not an inconsistency: a ledger entry is one sentence
  against one sentence, while an issue body is paragraphs against one sentence,
  and containment is blind to the longer operand — under it any long issue
  containing a short sentence's words scores 100% and the report is lost behind a
  comment on something unrelated. If you change one measure, read
  `overlapFor`'s docblock before you change the other.
- **Redaction already ran** over the prose in the plan. Do not paste raw bundle text
  into an issue or a PR body; use the plan.

## What you must not do

- Do not file anything not in the plan. The person confirmed a batch; this is that
  batch.
- Do not "improve" a sentence into a different claim. Sharpen the wording, never the
  meaning.
- Do not guess a file location to make a merge decision. An unchecked overlap
  reported as unchecked is honest; a guessed one produces conflicting PRs.
- Do not let `hunt-ui` file anything. It reports; this path files, and only what a
  person confirmed.
