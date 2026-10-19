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

## Fix round (panel after the maintainer takeover)

The peer jump got both halves of the containment; its two siblings into
the same live grid got neither. The lesson is that the channel, not the
caller, is the unit: a jump target is state that outlives a remount, so
withholding whatever stages it is never the whole fix.

- **`commentJumpTarget`** — the panel that stages it is withheld under a
  preview, but a target staged in the instant before survived, and
  survived the restore too. Its `sref` is resolved from the row/column
  order the restore replaced, so replaying it names an unrelated cell.
  Dropped in `handleHistoryRestored` and refused in the effect.
- **`undoJumpTarget`** — cleared on restore already, but its effect had
  no `previewing` arm, so it still called `focusUndoSelection` behind the
  banner. Same drop-don't-defer shape as the peer jump.
- The structural test is now table-driven over all three channels, which
  is what would have caught the two that were left behind.

## Fix round (panel after the jump-channel round)

The same lesson one layer out: the *surface inventory* is the unit. Each
round had withheld the surfaces that round's reviewer happened to name, so
docs got its find bar and both context menus while sheets — the same file,
the same `previewing` prop — kept both. Sweeping a view for every surface
that escapes its box, in one pass, is cheaper than being told about them
one at a time.

- **Sheet `FindBar` and grid context menu.** Neither was withheld, and the
  Cmd+F arm sat in the very keydown handler the previous round added two
  `if (previewing) return;` guards to. The context menu is the one surface
  that cannot be unmounted — its wrapper holds the canvas container, so
  dropping it remounts the grid — which is why `SheetContextMenu` grew a
  `disabled` prop that also refuses the selection write Radix leaves wired
  on a disabled trigger.
- **Hiding a surface ≠ neutralizing it.** Withholding `MobileEditPanel`
  left the engine's selection-change subscriber free to commit the draft to
  the live sheet (it fires on remote-change repaints, which keep arriving
  during a preview) and then discard it. Read through a ref, because the
  subscriber is registered once in the mount effect. The find bar had the
  mirror-image residue: unmounting it orphaned its match highlights on the
  engine, so the withholding effect calls `clearFind()` the way docs calls
  `clearSearchMatches()`.
- **Source-text tests cannot tell a guard that works from one that is
  present.** Every behavioural assertion in this branch had been
  `readFileSync` + substring. Both editors are now mounted for real against
  a stubbed engine (`sheet-view-preview.test.tsx`,
  `docs-view-preview.test.tsx`): ~14 tests driving the actual shortcuts,
  engine callbacks and render conditions. Each was checked by reverting the
  guard it covers — all fail without the fix. The one trap worth recording:
  an `async initialize()` that resolves with a catch-all `Proxy` hangs
  forever, because the synthesized `then` makes the double a thenable.

## Fix round (panel after the find-bar/context-menu round)

**Withholding a surface does not cancel the work it already started.**
The blast-radius lens traced the find bar's own debounce cleanup and found
it only clears a timer that has not fired. A search already dispatched is
an `await this.sheet.findCells(...)` inside the engine, and when it
resolves it calls `focusCell()` — a move of the *live* selection, which
republishes presence — and then `setSearchHighlights()`, re-arming exactly
what the new `previewing` effect's `clearFind()` had just dropped. The
unmount is invisible to it.

Guards on the React side cannot reach that: the call is already past them.
So the cancellation lives where the work does — `Spreadsheet` now carries a
`searchEpoch` that every search entry point bumps and every post-`await`
publish re-checks, so a scan whose epoch moved publishes nothing. The same
one line also fixes a pre-existing race nobody had named: two overlapping
queries from fast typing could land out of order and leave the older one's
results on screen under the newer one's query.

The React-side half is now only about this component's own state — a
`disposedRef` so a resolution arriving after unmount reports no count and
steals no focus back.

Tests: `packages/sheets/test/view/spreadsheet-find-abandon.test.ts`, four
cases against a hand-built context (the `spreadsheet-undo-selection.test.ts`
technique) with `findCells`/`focusCell` promises released by hand so the
abandonment window is a real one. Three of the four fail with the engine
guard reverted.

## Maintainer takeover 2 (round 9)

- **A cancellation token needs every abandonment path, not just the one the
  change was about.** `searchEpoch` was bumped by `find` and `clearFind()`
  but not `cleanup()`, so a tab switch or unmount mid-scan let the scan
  resume into a worksheet that had dropped its sheet — an uncaught
  TypeError. Teardown now bumps it.
- **Readers of a token must not also bump it.** `findNext`/`findPrevious`
  claimed a new epoch, so pressing Enter while a freshly typed query was
  still scanning cancelled that scan and left the bar on the old results.
  They now capture the current epoch: cancelled by a new query, a clear or a
  teardown, but never the thing doing the cancelling.

## Panel round 10 (blast radius + test adequacy)

- **A containment sweep has to cover the whole header, not the controls the
  last finding named.** Rounds 7–9 withheld the comments toggle and the peer
  jump out of the editor headers and left the one beside them: the title.
  Clicking it opens an input whose commit is a `PATCH /documents/:id` on the
  live document, so `SiteHeader` now takes `editable={!previewing}` and a
  `previewing ? undefined : handleRenameDocument` in both wired hosts.
  Revoking `editable` also closes an input that was *already* open — the
  prop alone only stops new entries, and an open input is exactly what the
  host meant to remove.
- **Source greps that name a surface read as coverage for it.** The comment
  popover, the comment-composer shortcut and the comments-panel shortcut
  were pinned only by `expect(source).toContain(...)`. They are now driven
  through the mounted `SheetView` harness; all three fail with their guard
  reverted (checked by hand).
- `Spreadsheet.cleanup()` bumping `searchEpoch` — raised again this round —
  had already landed in round 9 (`spreadsheet.ts:1011`), with the teardown
  case in `spreadsheet-find-abandon.test.ts`.
