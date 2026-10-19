# Lessons — history preview loading state (#1093)

## Implementation

- The banner was gated on `meta`, which is the *metadata* of the revision,
  not its content. Ungating it meant separating three states that had been
  one: loading (`!meta && !error`), loaded (`meta`), and failed (`error`).
  Restore is gated on `isLoading` and not on `content`: a snapshot that
  arrived but this build cannot parse already left Restore enabled, and
  correctly so — the restore is performed server-side and does not depend on
  our parser, so disabling it there would have been a behaviour change the
  issue did not ask for.

- Keying `isLoading` on `error` as well as `meta` is what stops a rejected
  `getRevision` — which sets `error` and never sets `meta` — from spinning
  forever. A spinner that never stops is the reported blank screen with extra
  steps.

- `getByRole('status')` was being used across three test files as "the
  preview has finished loading". That was only ever true because the banner
  was gated; making the banner unconditional turns those waits into no-ops
  that let assertions run against a still-loading overlay. Tightened them to
  the banner's own loaded text.

- The panel and the overlay are siblings with no common owner but the five
  editors, so "mark the clicked entry as loading" has no prop path that does
  not cross all five. `restore-lock.ts` had already answered the identical
  question for the restore lock, so `preview-loading.ts` copies its shape
  (module store + `useSyncExternalStore`) and inherits its one-document-per-page
  caveat verbatim.

## Self review

### Round 1 — correctness / tests

The independent reviewer **could not run** in this environment:
`node ./scripts/agent/spec-to-pr.mjs review` first failed on a missing
`@anthropic-ai/claude-agent-sdk` (fixed with `npm ci` in `scripts/agent/`),
then on `PANEL_INFRA_ERROR: [NO_RESPONSE] no response from the API` — so all
six lenses reported `failure (infra)`, not a verdict. A skipped review is not
a passing review; this is recorded as such on the PR rather than as a clean
round.

What the fallback read of the diff did surface, and what was done:

1. **Blocking (fixed).** The panel row's spinner was `h-3 w-3`, which
   `buttonVariants` silently overrides: its
   `[&_svg:not([class*='size-'])]:size-4` compound selector outranks a bare
   `h-3 w-3`, so the icon would have rendered at 4 rather than 3. Changed to
   `size-3`, which the `:not()` excludes.
2. **Deferred (known limitation, in the PR body).** `RevisionPreviewOverlay`
   is lazy and in a *different* chunk from `history-panel.tsx` (it pulls
   three engine packages), behind `ChunkBoundary fallback={null}`. So on the
   first Preview click of a session there is still a gap before anything
   publishes a loading id — the chunk's own download. Closing it means
   changing the fallback in five editors, which is wider than this issue.
   Reported rather than widened.
