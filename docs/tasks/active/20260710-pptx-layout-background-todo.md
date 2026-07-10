# PPTX import: layout-level background images dropped

## Problem

Importing `260708_Naver_HQ_발표자료_draft2_KR.pptx`, slide 1 loses its
bottom gradient. The gradient is not a shape — it is the layout's
background **image** (`ppt/media/image6.png`, containing the BytePlus
logo + purple→blue→cyan bottom gradient), referenced from
`slideLayout1.xml` as `<p:bg><p:bgPr><a:blipFill>`.

### Root cause

PPTX background inheritance is `slide → layout → master`. The runtime
renderer already implements this: `resolveBackgroundImage()` /
`resolveBackgroundFill()` (`model/presentation.ts`) walk
slide → layout → master and read `layout.background.image`.

But the **importer never populates `layout.background`**:

- `slide.ts` parses slide-level `<p:bg>` (only when present; slide1 has none).
- `master.ts` parses master-level `<p:bg>` (slideMaster1 is a `<p:bgRef>`, no image).
- `layout.ts` `parseLayout()` maps the OOXML layout onto a built-in layout
  and reads placeholder font sizes — it **never reads `<p:bg>`**.

So slide1's background resolves to the default theme role fill; the
layout's gradient image is silently dropped.

Compounding: imported layouts collapse onto the 11 built-in ids and are
dropped by `dedupeLayouts` (built-ins listed first, first-wins), so the
background must be overlaid onto the surviving built-in of the same id.

### Deeper root cause found mid-implementation

The background fix alone didn't work. Instrumenting the real import
revealed the **actual** root cause: the deck has **two slide masters**
(`slideMaster1` owns `slideLayout1–9`; `slideMaster2` owns
`slideLayout10–21`). The importer called `loadMasterAndLayouts` **once**
with `pickRelTarget(presRels, 'slideMaster')`, which returns whichever
master is first in rels-iteration order — here master2 — so master1's
layouts (**including slideLayout1**, slide 1's layout) were never loaded.
slide1's `layoutId` fell back to `title-body` by coincidence, and both its
layout background *and* placeholder geometry were dropped.

A follow-up report ("2026년 3월" renders top-left instead of bottom-left)
is the same family: the placeholder has an empty `<p:spPr/>` and inherits
its frame from the layout placeholder, but the importer only read layout
placeholder **font sizes**, never their **frames**.

## Plan

Fix 1 — multi-master + layout background:
- [x] Load **all** masters (`orderedMasterTargets`, `<p:sldMasterIdLst>`
      order), merge layouts + layoutMaps; first master is primary
- [x] Export `parseSlideBackground` from `slide.ts` (reuse, no third copy)
- [x] `layout.ts`: `parseLayout` → async, parse layout `<p:bg>` into
      `ImportedLayout.background` (image / explicit solid only)
- [x] Bake layout background onto slides without their own `<p:bg>` in
      `parseSlide`, keyed on the exact layout part path (collapse-safe)
- [x] Unit tests: `parseLayout` bg parse; `parseSlide` bakes it

Fix 2 — layout placeholder frame inheritance:
- [x] `parseLayout` extracts scaled placeholder frames →
      `LayoutResolution.placeholderFrames`
- [x] `parseSp` falls back to the layout frame when `<a:xfrm>` is absent
- [x] Unit tests: layout frame extraction + slide frame inheritance

Verify:
- [x] `pnpm --filter @wafflebase/slides test` (2563 passing)
- [x] E2E against the real Naver deck (local, not committed): slide 1
      resolves the gradient image; "2026년 3월" lands at x=68, y=982
- [ ] `pnpm verify:fast`

## Review

- Two distinct root causes behind one visible symptom; the background was a
  red herring until multi-master loading was fixed.
- Chose to **bake** layout backgrounds/frames onto slides (keyed by exact
  layout part path) rather than rely on runtime layout inheritance, because
  imported layouts collapse onto 11 built-in ids and can't carry per-layout
  data unambiguously.
- Known limitation (documented): per-master `clrMap` / theme still uses the
  primary master for all slides. Out of scope; pre-existing.

### Code review (high effort, workflow) — 7 findings, resolved

Fixed:
- **title/ctrTitle key mismatch** — added `phKey` normalization (shared by
  layout size/frame storage + slide lookup); also improves font-size
  inheritance. Test added.
- **solidFill/failed-upload baking `DEFAULT_BACKGROUND`** — `parseLayoutBackground`
  now gates on a resolved image OR a non-inheritable fill (exported
  `isInheritableFill`), so unresolved/bgRef backgrounds keep inheritance
  open instead of masking it. Removed the duplicated presence guard.
- **Inherited frame aliasing** — clone the layout `Frame` in `parseSp`.

Accepted as documented limitations (design doc):
- One deck-wide `clrMap` (primary master) for slides + baked backgrounds —
  affects only `solidFill` scheme-color backgrounds on a secondary master;
  `blipFill` (this deck) is unaffected.
- Eager per-layout background uploads → a few orphan blobs on template-heavy
  decks; lazy upload deferred.

Intentional (not a regression):
- Primary master now = `<p:sldMasterIdLst>` first entry (deterministic,
  canonical) instead of nondeterministic first-rel order.

### Second code review (post-review-fixes) — 4 findings

Fixed:
- **Partial `<a:xfrm>` collapsing to zero size** — `resolvePlaceholderFrame`
  now merges each axis (offset / extent) the slide omits from the layout
  frame, not just the all-absent case. Test added.

Accepted (documented in design doc):
- Explicit layout `solidFill bg1` not baked — model can't represent an
  explicit background-role fill vs inherit; resolves to the same theme bg.
- `phKey` collision only on non-conformant `title`+`ctrTitle`-at-same-idx.
- Eager per-layout background upload (efficiency; lazy pass deferred).
