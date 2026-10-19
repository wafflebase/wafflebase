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
- **Round 2 — the panel did run** (blast-radius, test-adequacy, security), and
  found that the guard had been applied to the surfaces the first draft
  happened to look at rather than to every surface that outranks the overlay.
  Acted on, all blocking:
  - The **keyboard twin** of the header toggle (`Cmd/Ctrl+Alt+Shift+M`,
    bound on `window` by `SheetView`) still flipped `commentsPanelOpen` from
    under a preview — the exact state write `EditingChrome` had just been
    added to prevent. Guarded in the handler.
  - `MobileEditPanel` is `fixed inset-x-0 z-50`: `fixed` leaves the surface
    box entirely, so covering never applied to it, and its commit writes the
    live sheet. Withheld.
  - The `linkHover` card, recorded above as a known limitation, was widened
    into the change after all — it is one term, and "read-only so it cannot
    write" does not excuse painting a live-grid link over a banner that says
    the user is looking at an old version.
  - **Docs had the same hole in two more places**: its comment popover and
    its insert-comment dialog are both `fixed … z-50`, so withholding only
    the *panel* left every live-write control reachable. `DocsView` now takes
    the same `previewing` prop and withholds both, plus its own comment
    shortcut.
  - The test-adequacy lens was right that source greps cannot see what the
    DOM ends up with (a portal renders into `document.body` either way).
    Added behavioural tests that mount the **real** `CommentPopover` and
    `CommentSidePanel` through `EditingChrome` and query the whole document
    for Reply / Resolve / Edit / Delete / Jump. Mounting `SheetView` itself
    is still out of reach in jsdom (Yorkie document + Canvas engine +
    router), so the wiring tests remain the link between the editors and the
    mechanism.
  - The "leaves the sheet panel toggle untouched" test was a negative regex
    that could not see the regression it claimed to guard — a `useEffect`
    keyed on `previewing` calling `setCommentsPanelOpen(false)` spans lines
    the regex never matches. Replaced with a structural scan of every
    `useEffect` in the file.
- The lesson underneath all of it: `z-30` was not the rule. The rule is
  **anything that is not painted below the overlay**, which includes every
  `fixed` descendant regardless of its `z-index`, because `fixed` escapes the
  positioned ancestor the overlay is sized to. Enumerating by `z-index` alone
  missed three surfaces across two editors.

## Review round (panel, 2026-10-18)

Four lenses converged on the same blocking finding, and it is the lesson
above repeating itself one more time: having stated the rule as "every
`fixed` descendant", the change then enumerated only the *comment*
surfaces of `DocsView` and stopped. Four more were left rendered under a
preview, each `fixed z-50`, two of them through a `document.body` portal:

- `DocsFindBar` — Replace / Replace All drive `FindReplaceState` at the
  store directly, which is why the bar carries its own `readOnly` gate:
  they never pass through the editor's `MUTATING_METHODS` neutralization.
  The worst of the four.
- `DocsLinkPopover` — Edit / Remove link, and it deliberately *does not*
  dismiss when the caret moves and has no outside-click handler, so it is
  the one most likely to still be open when a preview opens.
- `DocsContextMenu` / `DocsTableContextMenu` — spell corrections, paste,
  insert link, table row/column ops.

All four are now `!previewing`-gated. None of them could be *opened*
under a preview (the overlay takes the pointer before the container's
listener), but all four survive into one that opens while they are up —
which is what clicking the version-history entry does.

Two side effects of withholding by unmounting, which the comment surfaces
did not have:

- The find bar's query is its own component state, but its highlights are
  pushed onto the **editor** (`setSearchMatches`). Unmounting the bar
  would leave them painted on the live document with nothing left to
  clear them, so the view clears them when the preview opens — without
  `moveCursorToActive`, unlike the bar's own Close, because moving the
  caret publishes presence from a document the user is no longer reading.
- A staged `linkInputRequest` is handed back by the popover's
  `onEditRequestHandled`; withheld, nothing consumes it, so closing the
  preview would reopen the editor at coordinates measured before it. It
  is dropped in the same effect.

This is deliberately *not* done to the comments panel: that toggle is a
preference the user set and a preview has to give it back, which the
earlier round already pinned with a structural test. The find bar's
transient state is lost to the unmount either way.

## Maintainer takeover (after fix round 3 of 3)

The loop paged after round 5 with two blockers left; a maintainer closed
them locally rather than buying three more rounds, because each round had
been surfacing one more preview-escaping control rather than converging.

- **A staged peer jump replayed onto a restored document.** Restore
  remounts `SheetView` (`key={historyResetToken}`), which resets the
  mount-local "already handled" ref, and `handleHistoryRestored` cleared
  `undoJumpTarget` but not `peerJumpTarget`. Any target that outlives a
  remount replays — not only one deferred by the preview guard. Cleared on
  restore, and the guard now *drops* a staged jump instead of deferring it,
  so closing a preview never jumps to where a peer was at an unrelated
  moment.
- **A contract the fix leaned on had only a grep.** The hosts withhold
  `onSelectPeer`/`getJumpHint`; that `UserPresence` then offers no jump was
  asserted nowhere. Now rendered and clicked, overflow menu included, and
  mutation-checked: dropping the `disabled` flag or the overflow item's
  early return each fails a test.
- The containment rule had grown a third mechanism (call-site withholding
  for `fixed`/portalled surfaces, window shortcuts and the header) that
  `revision-history.md` §4 did not record; it does now.
