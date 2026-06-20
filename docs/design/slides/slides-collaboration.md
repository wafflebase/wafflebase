---
title: slides-collaboration
target-version: 0.5.0
---

# Slides Collaboration — current state & known gaps

## Summary

[slides.md](slides.md) describes the *intended* collaboration
architecture (Yorkie Trees for all text, a full presence system with
peer cursors and live drag frames). The shipped implementation is
narrower than that doc implies. This document records what actually
exists today, why it diverges, and the gaps that remain for true
multi-user editing parity with Docs.

It exists because the divergence is load-bearing: a contributor reading
only `slides.md` would assume notes/text merge character-by-character
and that peer cursors render — neither is true yet.

## Goals / Non-Goals

- **Goal:** be the single source of truth for "what works concurrently
  in Slides today" and enumerate the remaining work.
- **Non-Goal:** prescribe the final Tree-backed text design — that is a
  larger effort tracked separately (the "Phase 5" docs-IME bridge).

## What works today

Structural editing converges well because it rides Yorkie's CRDT ops
directly:

- Slide add / remove / duplicate / reorder (`Yorkie.Array.move`).
- Element add / remove / reorder (z-order = array order).
- `updateElementFrame` and the other `data`-level mutators (per-field
  LWW on commit at `mouseup`).
- Table structural ops (insert/delete row/column, merge/unmerge).
- `meta.unit`, `meta.recentColors`, themes, guides.

Remote changes propagate through `YorkieSlidesStore.onChange`, which
fires on every `remote-change` event. UI surfaces that subscribe to it
(canvas, thumbnails, toolbar enablement, and — as of the notes
live-sync fix — the speaker-notes panel) refresh live.

## Gap 1 — speaker notes (FIXED for live sync; still LWW)

**Symptom (resolved):** a peer's note edits did not appear until the
local user navigated slides. `mountNotesPanel` subscribed only to
`editor.onSelectionChange` / `onCurrentSlideChange`, neither of which
fires on a remote change. Fixed by subscribing the notes panel to
`store.onChange` with a focus guard (don't overwrite the local caret
mid-keystroke) and disposing the subscription. See
[20260620-slides-notes-live-sync-todo.md](../../tasks/active/20260620-slides-notes-live-sync-todo.md).

**Remaining:** `withNotes` stores notes as a plain `Block[]` and writes
the whole array on every keystroke (`s.notes = clone(next)`). Two users
editing the same slide's notes concurrently clobber each other (whole-
array LWW), and the panel is a plain `<textarea>` with no rich text.
`slides.md` claims `notes: Yorkie.Tree`; that is aspirational. The
code comments mark the Tree-backed rich-text notes as "Phase 5".

## Gap 2 — text-element / shape / table-cell bodies are LWW-on-blur

`withTextElement`, `withShapeText`, and `withTableCellBody` store plain
`Block[]` JSON and commit on blur. The store comment states it
plainly: *"last-write-wins on commit (blur)"*
(`yorkie-slides-store.ts`). Two users editing the same text box → the
last to blur wins; the other's edits are lost. There is no
character-level merge.

Docs solves this with character-level intent-preserving Tree edits
(see [docs-intent-preserving-edits.md](../docs/docs-intent-preserving-edits.md)).
`slides.md` (the "Text-element bodies … are full Yorkie trees"
paragraph) describes that target shape, but Slides has not adopted it.
Closing this gap is the largest piece of remaining collaboration work
and should reuse the docs Tree bridge rather than inventing a new one.

## Gap 3 — presence is half-wired

`SlidesPresence` (`packages/frontend/src/types/users.ts`) defines
`activeSlideId`, `selectedElementIds`, `activeFrames` (live drag
preview), and `draggingGuide`. In practice:

- `updatePresence` is called from exactly one place
  (`slides-view.tsx`) and broadcasts only `activeSlideId` +
  `selectedElementIds`.
- `activeFrames` and `draggingGuide` are **never broadcast** — there is
  no live drag/resize/rotate or guide-drag preview for peers, despite
  `slides.md` listing "drag/resize/rotate broadcast intermediate frames
  via presence."
- `getPeers()` exists but is **never consumed**. Nothing renders peer
  cursors, peer selection rings, live peer drag frames, or a per-slide
  "who's editing here" indicator on the canvas or thumbnails.
- `slides.md` also references a `textCursor` presence field and peer
  cursor labels (à la `docs/docs-presence.md`); neither exists. Docs
  has `packages/docs/src/view/peer-cursor.ts`; Slides has no analogue.

The avatar stack in the document header (`user-presence.tsx`) works —
that is separate, document-level Yorkie presence, not in-canvas peer
feedback.

## Gap 4 — `slides.md` is stale

The data-model and presence sections of `slides.md` document the
intended Tree-backed text and full presence system as if shipped. They
should be read as design intent, not current behavior; this document is
the reconciliation. Inline status notes have been added at the relevant
spots in `slides.md` pointing here.

## Risks and Mitigation

- **Risk:** contributors build on the assumption that Slides text
  merges concurrently. **Mitigation:** this doc + the inline status
  notes in `slides.md`.
- **Risk:** the notes focus-guard is coarse (skips all writes while the
  textarea is focused), so a peer's note edit is invisible to a user
  who is actively typing notes until they blur. **Mitigation:**
  acceptable while notes are whole-array LWW — a focused user already
  owns the field; revisit when notes become Tree-backed.

## Remaining work (suggested order)

1. Tree-backed text bodies (text elements, then shape/table cells)
   reusing the docs Tree bridge — closes Gap 2 and, by extension, the
   notes Tree migration in Gap 1.
2. Broadcast `activeFrames` during drag/resize/rotate and render peer
   drag previews — closes the live-feedback half of Gap 3.
3. Render peer selection rings + a `textCursor`-based peer caret reusing
   `docs/view/peer-cursor.ts` — closes the rest of Gap 3.
