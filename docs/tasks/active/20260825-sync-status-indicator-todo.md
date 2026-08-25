# Sync status indicator — TODO

Design: [`docs/design/sync-status.md`](../../design/sync-status.md)

## Problem

A document editor that has lost its Yorkie connection is visually identical to
one that has not. Editing continues, the changes queue locally, and nothing on
screen says so. Closing or reloading the tab discards the queue — the Yorkie JS
SDK holds it in memory only — with no prompt at any point.

## Evidence

- `grep -rn 'ConnectionChanged|SyncStatusChanged|hasLocalChanges|StreamConnectionStatus|DocSyncStatus|navigator.onLine' packages --include=*.ts --include=*.tsx`
  returns **3 hits, all in one file**:
  `packages/design-sandbox/src/scenes/canvas/yorkie-offline.tsx` — the design
  editor's offline mock, which hardcodes `Disconnected` (`:289`). No production
  code consumes any connection or sync signal.
- `grep -rn 'beforeunload' packages/frontend/src` → **0 hits**.
- `@yorkie-js/sdk/dist/yorkie-js-sdk.js` contains **0** occurrences of
  `indexedDB` or `localStorage`. Local changes are RAM-only, so the loss on
  reload is real and unconditional.

## Approach

Read the signals the SDK already emits — `connection`, `sync`, and the
`local-change` event weighed against `doc.getCheckpoint().getClientSeq()` —
derive a 4-state `SyncState`, and render it from one shared chip mounted in
`SiteHeader`, which sits inside the `DocumentProvider` subtree in every editor
(proven by `UserPresence` calling `useDocument()` from there today,
`components/user-presence.tsx:51`).

Severity keys on whether the user has outstanding work, not on connectivity: a
disconnected *reader* sees a muted `Reconnecting…`; only a disconnected editor
with an unacknowledged edit gets `Not saved`, the toast, and the unload guard.

Three assumptions here did not survive contact with the code — the mount cannot
be unconditional, PDF is not covered, and `hasLocalChanges()` (the obvious
signal, and what the first three phases used) counts presence and so cannot
drive this at all. See [Correction to the
design](#correction-to-the-design) and Phase 5.

## Changes

### Phase 1 — the hook

- [x] `packages/frontend/src/components/sync-status/sync-state.ts` — the state
      machine split out as a pure function, so the decision that matters is
      testable as a truth table rather than through a rendered component.
- [x] `packages/frontend/src/components/sync-status/use-sync-status.ts`
  - [x] `SyncState = 'saved' | 'saving' | 'reconnecting' | 'not-saved'`.
  - [x] Connection from `useDocument().connection`; `doc.subscribe('sync', …)`
        for sync outcomes.
  - [x] ~~Poll `doc.hasLocalChanges()` on a 1s interval~~ — removed in Phase 5;
        there is no polling at all.
  - [x] Only `setState` when the derived `SyncState` changes (otherwise the
        header re-renders once a second for the whole disconnection). Done via
        a `pendingRef` mirror rather than trusting React's bail-out.
  - [x] Track `pendingSince` — stamped when the queue goes empty → non-empty,
        cleared when it drains.
  - [x] `DocSyncStatus.SyncFailed` while connected also resolves to
        `not-saved`, and is ignored once the queue has drained.
  - [x] No document yet → `saved`, not `reconnecting`. Found by the test:
        falling through flashes "Reconnecting…" on every document open for the
        length of the attach.
  - [x] `@yorkie-js/sdk` is a **devDependency**, so its `StreamConnectionStatus`
        / `DocSyncStatus` enums cannot be imported as values. Compared through
        `String()` against the documented members instead.

### Phase 2 — the chip

- [x] `packages/frontend/src/components/sync-status/sync-status-chip.tsx`
  - [x] Four states per the design's table; only `not-saved` is destructive.
  - [x] Tooltip that names the tab as the only copy — never implies local
        durability. Pinned by a test asserting the copy never says "this
        device" / "saved locally" / "offline".
  - [x] `saved` hidden below `sm` via `hidden sm:flex` — CSS, not a JS media
        query, so it costs no listener.
- [x] `packages/frontend/src/components/site-header.tsx` — **opt-in**
      `syncStatus` prop, not an unconditional mount. See the correction below.
- [x] `packages/frontend/src/app/shared/shared-header-status.tsx` — new; folds
      the "View only" badge the five shared layouts had each duplicated into
      one component that answers the whole question (badge for a viewer, chip
      for an editor).
- [x] `packages/frontend/src/app/shared/shared-document.tsx` — five inline
      badges replaced with `<SharedHeaderStatus readOnly={readOnly} />`.
- [x] Six editor call sites pass `syncStatus`: sheets, docs, notes, board,
      slides desktop, slides mobile.

### Phase 3 — notice + guard

- [x] Transition toast (`sonner`, already mounted in `App.tsx`) on entering
      `not-saved`; 2s debounce so a self-healing blip is silent.
- [x] Recovery dismisses it and shows a brief `Saved` confirmation — only when
      a warning was actually shown.
- [x] `beforeunload` registered **only** while `not-saved`, removed as soon as
      the state leaves it.

### Phase 4 — chip strobe found in the smoke test

Typing continuously in the docs editor made the chip flicker between `Saved`
and `Saving…` several times a second. Not a rendering bug: the queue really is
empty about as often as it is full mid-sentence, and every observation was
being reported.

- [x] Failing test first — `holds saving through the gaps between keystrokes`
      reproduced it (`expected 'saved' to be 'saving'`).
- [x] **First attempt, insufficient.** Held an empty observation for 800 ms
      before believing it. Re-tested by hand: still awkward. Nothing *re-raised*
      the state when the next keystroke arrived — keystrokes were not a signal
      at all — so it changed the rhythm of the flicker without removing it.
      Recorded rather than quietly replaced, because "add a debounce" is the
      obvious wrong answer here and the next person will reach for it too.
- [x] **Root cause.** `sample()` ran only on `sync` events and the poll. A push
      lands within milliseconds, so those reads land at moments uncorrelated
      with typing and see an empty queue mid-sentence. `hasLocalChanges()` can
      never drive this on its own.
- [x] `Saving…` is now raised by the **`local-change` event** (edge-triggered,
      cannot be missed) and by any non-empty queue read, and lowered only after
      a 2 s quiet window that *also* re-checks the queue — a quiet keyboard is
      not a flushed document, so it re-arms if the server still has the work.
      Remote changes excluded: a peer's edit must not hold up this user's chip.
- [x] Three new failing tests first: types → `saving` immediately; a six-
      keystroke burst with a permanently empty queue stays `saving`; it settles
      only once typing stops. Plus a guard that a full queue never settles no
      matter how long it waits.
- [x] `SyncSignals.hasLocalChanges` renamed to `pending`. Conflating "the queue
      is empty right now" with "there is no outstanding work" *is* the bug; a
      field name that keeps the two apart is worth the churn.
- [x] Quiet timer cleared on unmount.

### Phase 5 — dragging a cell in Sheets toggled the chip

Selecting cells with the mouse — editing nothing — flipped `Saving`/`Saved`.

- [x] **Root cause, from the SDK's published `Document.update()`:**
      `this.localChanges.push(change)` runs for **every** change, presence-only
      included, while the `local-change` event is published only
      `if (opInfos.length)`. A drag writes presence, so it fills the queue and
      emits no event — `hasLocalChanges()` goes true with nothing edited. Every
      editor was affected; moving a caret in Docs did the same.
- [x] The queue is a transport detail, not a record of the user's work. Replaced
      it with the exact question: the `local-change` event's `clientSeq` versus
      `doc.getCheckpoint().getClientSeq()` (both public API). Presence bumps the
      sequence but never produces an event, so it can no longer enter into it.
- [x] Two failing tests first: a bare drag (with the `sync` event that really
      follows the presence push) stays `Saved`; a drag after an accepted edit
      does not hold `Saving` up.
- [x] Test fakes rewritten to model the asymmetry — `type()` bumps the sequence
      *and* emits `local-change`, `drag()` only bumps it. The first version of
      the drag test passed against the broken code because it omitted the sync
      event; a fake that does not reproduce the SDK's shape proves nothing.
- [x] **The 1s poll is gone.** With raising event-driven and lowering
      sequence-based it had nothing left to observe. A document nobody is
      editing now schedules no timer and asks the SDK nothing at all.

## Correction to the design

Two claims in the first draft of `docs/design/sync-status.md` were wrong and
have been fixed in the same branch:

1. **"The chip goes in `SiteHeader`; every editor gets it with no per-type
   change."** `SiteHeader` is also mounted by `app/Layout.tsx` (the documents
   list) and `app/files/file-shell.tsx` (the static-file viewer), neither of
   which has a `DocumentProvider` — and `useDocument()` *throws* outside one.
   An always-on chip would have taken the documents list down. It is opt-in
   via a `syncStatus` prop instead, which keeps the position uniform while
   letting the two document-less shells abstain.
2. **PDF comments are covered.** They are not. `file-shell.tsx` mounts no
   provider; the PDF comment document lives further down in `pdf-collab.tsx`.
   Reaching it means restructuring that shell — out of proportion to the risk,
   and now recorded as excluded.

## Tests

33 new, all written before the code they cover and watched fail first.

- [x] `tests/components/sync-status/sync-state.test.ts` (6) — the truth table,
      including the two asymmetries: a rejected push with a non-empty queue is
      `not-saved`, a failed pull with an empty one is not.
- [x] `tests/components/sync-status/use-sync-status.test.ts` (15)
  - [x] Typing raises `saving` immediately and holds it across a whole burst
        even with a permanently empty queue; it settles only once typing
        stops; a full queue never settles however long it waits. (Phase 4.)
  - [x] Each of the four states from a stubbed doc.
  - [x] `SyncFailed` while connected → `not-saved`, and cleared on `synced`.
  - [x] The queue is **not** read on a timer while connected + empty; it is
        while disconnected. Guards the "polls nothing when healthy" rule.
  - [x] A tick that does not change the derived state does not re-render.
  - [x] `pendingSince` stamped on fill, cleared on drain.
  - [x] No document yet → `saved`.
- [x] `tests/components/sync-status/sync-status-chip.test.tsx` (8)
  - [x] `beforeunload` added on entering `not-saved`, removed on leaving, never
        added for a healthy document — the regression that would otherwise
        prompt on every navigation.
  - [x] Debounce: a disconnect that resolves inside the window fires no toast;
        one that outlasts it fires exactly one.
  - [x] Recovery confirms only after a warning was shown.
  - [x] The copy never claims local durability.
- [x] `tests/components/sync-status/site-header-sync-status.test.tsx` (2) — no
      chip by default (the documents-list crash), chip when opted in.
- [x] `tests/components/sync-status/shared-header-status.test.tsx` (2) — badge
      for a viewer, chip for an editor.

## Verify

- [x] `pnpm --filter @wafflebase/frontend lint` clean
- [x] `pnpm --filter @wafflebase/frontend test` — 1639 passed / 44 skipped
      (was 1606), no regressions
- [ ] `pnpm verify:fast`
- [ ] Self code review over the branch diff
- [ ] Manual, per the design's premise — in `pnpm dev`, open a doc, then
      DevTools → Network → Offline:
  - [ ] Chip goes `Saved` → `Reconnecting…` with no toast while idle.
  - [ ] Type one character → `Not saved` + toast.
  - [ ] Attempt to close the tab → browser confirmation appears.
  - [ ] Go back online → queue drains, chip returns to `Saved`, toast clears,
        closing the tab no longer prompts.
  - [ ] Repeat on a second type (slides or sheets) to confirm the `SiteHeader`
        mount covers it with no per-engine change.
- [ ] No visual-lane impact expected; if the header baseline moves, the chip's
      `saved` state is rendering when it should be `null` on narrow viewports.

## Out of scope

- **Offline persistence** (IndexedDB-backed local change queue). It is what
  would make a calm "saved to this device" state honest, and it is the natural
  successor to this work — but it carries reattach, GC, and epoch-mismatch
  questions this branch does not open. File as a follow-up issue once the chip
  is shipped and the state machine has proven itself.
- **A user-facing offline mode toggle** — nothing to toggle without the above.
- **Retry/backoff tuning.** Reconnection stays the SDK's watch loop; this
  reports it and does not steer it.

## Notes

- Do **not** run `pnpm tasks:index` on this branch — regenerating the index on
  a branch conflicts with every other open task branch. Regenerate once after
  merge.
