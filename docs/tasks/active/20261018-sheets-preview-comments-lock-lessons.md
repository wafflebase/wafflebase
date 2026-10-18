# Lessons — Sheets: lock comments during a revision preview (#1094)

## Notes

- `PreviewSurface` containment is by z-order, and it only works for children
  that create no stacking context of their own. The sheet comment popover is
  `absolute z-30` and the overlay is `z-20`, so being a descendant of the
  surface bought nothing — the same trap `docs-detail.tsx` hit with its `z-40`
  panel. Anything z-indexed above the overlay has to be *withheld*, not covered.
- Withholding a panel is only half of it: the **toggle that owns the panel's
  state** has to go with it. Left rendered, it reports `aria-pressed` for a
  panel that is not on screen, and one click flips the state off — so closing
  the preview gives nothing back, which defeats the reason for withholding
  rather than closing. Docs already wrapped its toggle in `EditingChrome`; the
  first draft of this change copied the panel line and missed that.
- A capture-phase keyboard suppressor that lives inside a **lazily loaded**
  overlay does not exist yet during the window between "preview requested" and
  "chunk resolved". Any handler it is relied on to stop needs its own guard.

## Self review

- **Round 1 — the review panel could not run.**
  `node ./scripts/agent/spec-to-pr.mjs review` first failed outright
  (`scripts/agent/node_modules` was missing `@anthropic-ai/claude-agent-sdk`);
  after `npm ci` it reached the API and every one of the six lenses came back
  `failure (infra)` with `PANEL_INFRA_ERROR: [NO_RESPONSE] no response from the
  API`. No lens produced a verdict, so **no round of the real panel has run on
  this branch** and nothing here may be read as a clean panel round.
- **Round 1 (substitute) — one independent fresh-context reviewer**, launched
  as a subagent over `git diff origin/main...HEAD`, weighted to correctness and
  test adequacy. Blocking: the comments **toggle button** was left live during a
  preview (above). Fixed by wrapping it in `EditingChrome`, matching
  `docs-detail.tsx`, and adding `<IconMessage` to that file's `removed`
  allowlist in `preview-surface.test.tsx`.
  Non-blocking, also acted on: the composer shortcut's pre-overlay write window
  (guarded + asserted); two test comments that overstated what they proved
  (reworded, and the forward-guard test labelled as such).
  Non-blocking, not acted on: the `linkHover` card is the other `z-30` surface
  but is read-only, so it cannot reach the live document — recorded as a known
  limitation in the PR body rather than widened into this change.
  Disputed: the reviewer called `previewing && previewRevisionId && currentUser`
  tautological dead code. It is not — `previewing` is a `boolean`, so it does
  not narrow `previewRevisionId` from `string | null` to `string` for the
  `revisionId` prop. The conjunction is load-bearing for the type checker, and
  it is what `docs-detail.tsx` already does.
- Stopped at round 1 of 3: the machine panel is unavailable in this
  environment, so re-running it would produce the same infra failure rather
  than a second lens. A human reviewer should treat this branch as
  **unreviewed by the panel**.
