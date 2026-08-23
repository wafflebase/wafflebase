# Carry caret lineAffinity through the whole round-trip (#933)

Follow-up to #66 / PR #930. `DocPosition.lineAffinity` exists and the peer
*highlight* honours it, but several sites on the same publish → anchor →
resolve → render loop still drop it, so a wrap-boundary caret degrades to
the default backward reading.

## Problem sites (from the issue)

1. `packages/docs/src/view/editor.ts:1563` — peer caret hardcodes
   `resolvePositionPixel(peer.position, 'backward', …)` while the peer
   highlight (`:1620`) honours per-endpoint affinity, so a peer's caret can
   sit a visual line above the end of their own highlight.
   `scrollToPosition` hardcodes it the same way.
2. `recordHistoryPresence` (frontend `yorkie-doc-store.ts`) republishes
   `activeCursorPos` as `{blockId, offset}`, erasing the wire field after
   every edit (and so on undo/redo restore).
3. `Cursor.moveTo` writes the affinity to `Cursor.lineAffinity` but never
   onto `this.position`, while presence publishes `cursor.position` — so
   only *mouse-derived* carets ever publish an affinity, which makes the
   `restoreLocalCursor` fix in #930 a no-op for Home / arrow carets.

## Approach — one home for caret affinity

`Cursor.position` (a `DocPosition`) is the single home. `Cursor.lineAffinity`
becomes an accessor pair over `position.lineAffinity`, so every existing
read/write site keeps working while the value lives in exactly one place and
travels with the position into presence, history, and rendering. A caret
position always states its reading (materialized, defaulting to `'backward'`)
— absent stays reserved for endpoints from other producers (search matches,
comment markers), which keep `computeSelectionRects`' asymmetric default.

`resolvePositionPixel` falls back to `position.lineAffinity` when the caller
passes no affinity, so a future call site that forgets it gets the position's
own reading instead of a hardcoded one.

## Steps

- [x] `cursor.ts`: `position` is the home; `lineAffinity` getter/setter;
      `moveTo` derives the default from `pos.lineAffinity`.
- [x] `peer-cursor.ts`: `resolvePositionPixel` affinity param optional,
      falling back to `position.lineAffinity ?? 'backward'`.
- [x] `editor.ts`: peer caret + `scrollToPosition` read the position's
      affinity; undo/redo presence restore carries it; `restoreLocalCursor`
      simplified onto the single home; `onCursorMove` / `setCursorForHistory`
      types carry it so the frontend sees the field it is being handed.
- [x] `yorkie-doc-store.ts`: `pendingCursorPos` / `setCursorForHistory` /
      `recordHistoryPresence` / `getPresenceCursorPos` carry `lineAffinity`.
- [x] `types/users.ts`: drop the stale "peer caret still resolves backward".
- [x] Design docs: `docs-presence.md`, `docs-local-caret-anchoring.md`.
- [x] Tests: first docs test that builds a real editor + `TextEditor` and
      drives keyboard events, pinning that Home / arrow carets publish an
      affinity and that the peer caret honours it.

## Acceptance criteria

- Peer caret and peer highlight resolve on the same visual line at a wrap
  boundary.
- An edit does not erase `activeCursorPos.lineAffinity`.
- Home / arrow carets publish an affinity (not just mouse clicks).
- A test fails if a call site stops attaching the affinity.
