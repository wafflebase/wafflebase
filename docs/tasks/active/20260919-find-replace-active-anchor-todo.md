# Anchor the active find match by position before replacing (PR #1084)

PR #1084 (fork, `yexnsxo:fix/docs-find-replace-stale-matches`) fixes issue
#1083: `Replace` / `Replace All` wrote at offsets captured by the last
`search()`, so an edit made while the find bar was open moved the text out from
under them and the write landed on the wrong characters.

The fix — re-run `search()` at the top of both replace methods — is right, but
the review panel found one blocking consequence and a cluster of smaller ones.
This task lands the follow-up on the same PR branch, then merges it.

## Findings to address

- [x] **Blocking** — `search()` re-binds the active match by *ordinal* index.
      If the intervening edit added or removed an occurrence *before* the
      active one, index N now names a different occurrence than the one the bar
      highlighted, so `Replace` rewrites text the user never selected.
      → re-anchor by position.
- [x] Find-bar guards (`state.activeIndex < 0`, `state.matches.length === 0`)
      are evaluated against pre-refresh state, so a click can silently no-op
      and the highlights never catch up.
- [x] Tests: the `replaceAll` case has a single match, so it duplicates the
      `replaceActive` case and never exercises the multi-match reverse sweep;
      nothing asserts `matches` / `activeIndex` after the forced re-search; the
      newly reachable zero-matches-after-edit early return is untested.

## Findings rebutted (see `--rebuttals` section of the lessons file)

- [x] "the new `search()` can throw uncaught out of the replace click handler"
- [x] "Replace All now rewrites matches the user was never shown"
- [x] "extra unbounded regex scan amplifies the ReDoS surface"

## Plan

- [x] `packages/docs/src/view/find-replace.ts` — private `refresh()` that
      re-runs the search and re-anchors the active match to the nearest match
      in the same block, ties going to the later one.
- [x] `packages/frontend/src/app/docs/docs-find-bar.tsx` — let the refreshed
      state decide; always sync highlights afterwards.
- [x] `packages/docs/test/view/find-replace.test.ts` — re-anchoring,
      multi-match `replaceAll` after a shift, zero-matches-after-edit,
      post-refresh `matches` / `activeIndex` assertions.
- [x] `pnpm verify:fast`
- [x] Push to the fork branch, wait for required checks, squash-merge.

## Review

Landed as PR #1084. See `20260919-find-replace-active-anchor-lessons.md`.
