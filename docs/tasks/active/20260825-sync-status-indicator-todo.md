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

Read the three signals the SDK already emits — `connection`, `sync`,
`hasLocalChanges()` — derive a 4-state `SyncState`, and render it from one
shared chip in `SiteHeader`, which sits inside the `DocumentProvider` subtree
in every editor (proven by `UserPresence` calling `useDocument()` from there
today, `components/user-presence.tsx:51`).

Severity keys on `hasLocalChanges()`, not on connectivity: a disconnected
*reader* sees a muted `Reconnecting…`; only a disconnected editor with a
non-empty queue gets `Not saved`, the toast, and the unload guard.

## Changes

### Phase 1 — the hook

- [ ] `packages/frontend/src/components/sync-status/use-sync-status.ts`
  - [ ] `SyncState = 'saved' | 'saving' | 'reconnecting' | 'not-saved'`.
  - [ ] Subscribe to `doc.subscribe('connection', …)` and
        `doc.subscribe('sync', …)`; recompute on each.
  - [ ] Poll `doc.hasLocalChanges()` on a 1s interval **only** while
        disconnected or pending — a healthy connected doc polls nothing.
  - [ ] Only `setState` when the derived `SyncState` changes (otherwise the
        header re-renders once a second for the whole disconnection).
  - [ ] Track `pendingSince` — stamped when the queue goes empty → non-empty,
        cleared when it drains.
  - [ ] `DocSyncStatus.SyncFailed` while connected also resolves to
        `not-saved`.

### Phase 2 — the chip

- [ ] `packages/frontend/src/components/sync-status/sync-status-chip.tsx`
  - [ ] Four states per the design's table; only `not-saved` is destructive.
  - [ ] Tooltip that names the tab as the only copy — never implies local
        durability.
  - [ ] Returns `null` in `saved` on narrow viewports (mobile slides header).
- [ ] `packages/frontend/src/components/site-header.tsx` — render it left of
      the `children` slot. This is the only edit the five owned editors need.
- [ ] `packages/frontend/src/app/shared/shared-document.tsx` — separate mount
      in the bare top bar, gated on the share role being editable.

### Phase 3 — notice + guard

- [ ] Transition toast (`sonner`, already mounted in `App.tsx`) on entering
      `not-saved`; ~2s debounce so a self-healing blip is silent.
- [ ] Recovery dismisses it and shows a brief `Saved` confirmation.
- [ ] `beforeunload` registered **only** while `not-saved`, removed as soon as
      the state leaves it.

## Tests

- [ ] `packages/frontend/tests/components/sync-status/use-sync-status.test.ts`
  - [ ] Each of the four states from a stubbed doc
        (`connection` × `hasLocalChanges`).
  - [ ] `SyncFailed` while connected → `not-saved`.
  - [ ] No interval is scheduled while connected + empty; one is while
        disconnected. Guards the "polls nothing when healthy" rule.
  - [ ] A tick that does not change the derived state does not re-render.
- [ ] `packages/frontend/tests/components/sync-status/sync-status-chip.test.tsx`
  - [ ] `beforeunload` listener is added on entering `not-saved` and removed on
        leaving it — the regression that would otherwise prompt on every
        navigation.
  - [ ] The shared **editable** layout renders the chip; the read-only one does
        not. This is the one mount that can drift from `SiteHeader`.
  - [ ] Debounce: a disconnect that resolves inside the window fires no toast.

## Verify

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
