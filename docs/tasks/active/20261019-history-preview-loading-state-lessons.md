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

Run via the `/code-review` skill over the branch diff; see the PR comment
beginning `<!-- agent-self-review -->` for the outcome.
