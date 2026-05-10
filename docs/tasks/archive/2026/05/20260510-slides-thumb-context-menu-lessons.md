---
title: Slides editor UX fixes — lessons
target-version: 0.3.8
---

# Lessons

## Canvas 2D doesn't understand `currentColor`

Setting `ctx.strokeStyle = "currentColor"` on a Canvas 2D context silently falls back to black — the keyword is a CSS concept, not a Canvas color. The shape picker had been doing this since landing and it only became visible once dark-mode preview reuse made the black strokes invisible against the dark popover background.

Resolve through the DOM instead: `ctx.strokeStyle = window.getComputedStyle(canvas).color`. The canvas must be in the DOM for the cascade to be ready, so doing this inside the `useEffect` (after mount) works.

## Pre-existing `showContextMenu` was already wired up

The slides package ships a vanilla-DOM `showContextMenu` helper (`src/view/editor/context-menu.ts`) used by the canvas right-click. The thumbnail panel had a comment from the original implementation referencing T4's intended use — it was planned-but-never-finished work. Using the existing helper kept the menu visually consistent with the canvas right-click and avoided adding a Radix dependency to the slides package (which is intentionally vanilla DOM for reuse).

## Canvas right-click selection-collapse pattern is reusable

The canvas right-click semantics in `editor.ts` (`elementContextItems`) collapse the selection to the right-clicked element when it isn't already in the selection set. Ported verbatim to the thumbnail panel: right-clicking a slide *outside* the shift-multi-set replaces the multi-set with just that slide. This prevents the foot-gun of "I right-clicked slide X but Delete nuked slide Y".

## Always-one-pressed needs an explicit Select state

The original toolbar had Text + Shape Toggle buttons. With both unpressed (in selection mode), the user had no visual indicator of which mode they were in — they just *weren't* inserting. Adding a third Select toggle whose pressed state is `insertMode === null` partitions the `InsertKind | null` type into three pressed states (Select / Text / Shape), so exactly one is always pressed.

The Select toggle uses `onClick` (not `onPressedChange`) because Toggle would otherwise want to flip its `pressed` state on every click — clicking an already-pressed Select would call `onPressedChange(false)`, which is meaningless here. With `onClick`, every click is idempotent: `setInsertMode(null)`.

## Empty-deck render bail-out forces seeding on first mount

`SlidesEditor.render()` bails out when no current slide exists. Brand-new presentations land here with `slides: []`, which means the canvas stays blank until the user clicks "+ Slide". Seeding a single blank slide in `slides-view.tsx` after `ensureSlidesRoot` fixes this.

The seed is concurrency-naive: two clients first-mounting the same fresh doc could both seed, yielding 2 slides. This matches the established `docs-view.tsx` `ensureTree` pattern, so we accept it for consistency. A future improvement could gate via a `meta.seeded: boolean` flag set inside the seed batch.

## Canvas right-click anchor capture is safe across menu lifetime

Inside the contextmenu listener, capturing `event.clientX/Y` in a closure that runs later (when the user clicks "Change layout…") works because MouseEvent coordinates are immutable after dispatch — the original right-click position is preserved even after the menu has been mounted, dismissed, and a new picker has opened. Worth knowing if any future async step is added between menu build and item-run.
