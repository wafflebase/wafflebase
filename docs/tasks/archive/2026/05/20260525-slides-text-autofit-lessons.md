# Slides Text Autofit — Lessons

## What shipped

3-mode autofit (`none`/`shrink`/`grow`) for slides text boxes, GS/PPT
parity. Hybrid persistence: shrink scale derived live (never stored),
grow `frame.h` written on commit. Engine `model/autofit.ts` on top of
docs `computeLayout`; committed renderer + in-place editor share the
scale; placeholders default shrink, free text boxes default grow; PPTX
`<a:bodyPr>` mapped on import.

## Lessons (things that bit, or nearly did)

1. **Adding a field to placeholder specs is not enough — the stamping
   sites drop it.** `MemSlidesStore.addSlide` and `applyLayoutToSlide`
   both re-seed text placeholders with master typography via
   `cloned.data = { blocks: seedPlaceholderBlocks(...) }` — a full
   reassignment that discards every other `data` field (`autofit`,
   `stroke`, `fill`). The unit test that asserted `BUILT_IN_LAYOUTS`
   specs carry `autofit: 'shrink'` PASSED while real slides got nothing.
   Fix: `data = { ...cloned.data, blocks }`, and test END-TO-END through
   `addSlide`/`applyLayoutToSlide`, not the spec constant. **Rule:** when
   you add a field to an element/placeholder, grep every site that
   rebuilds that element's `data`/object and test the real construction
   path.

2. **No node-canvas in the slides/docs test env.** `CanvasTextMeasurer`
   throws when asked to measure non-empty text under Vitest/jsdom. All
   docs text-box tests mount with EMPTY blocks for exactly this reason
   (empty paragraph → `computeLayout` never calls `measureWidth`). Engine
   tests inject a fake `TextMeasurer` (`measureWidth = len*size*k`) so
   wrapping is deterministic and non-linear. **Rule:** anything touching
   text measurement must either use empty blocks or a fake measurer.

3. **A throw in derived-value computation must not roll back the real
   write.** The grow-commit path computes `computeAutofitHeight` with a
   `CanvasTextMeasurer` (throws headless). Computing it INSIDE the
   `store.batch()` alongside `withTextElement` would let a measurement
   failure roll back / lose the user's text. Fix: compute the height
   BEFORE the batch, guarded by try/catch, then write text + height
   together in one batch (height only when defined). **Rule:** keep
   best-effort derived computation out of the transaction that carries
   the must-persist data.

4. **The docs text-box editor never reuses its LayoutCache.**
   `recomputeLayout` passes `dirtyBlockIds = undefined`, and
   `computeLayout`'s `canUseCache` requires `dirtyBlockIds != null`. So
   every render is a full fresh layout — which is why a shrink scale that
   changes per keystroke (live autofit) is safe: there is no stale cached
   line data. A code reviewer flagged a "stale cache" risk; it does not
   apply for this caller.

5. **Shrink scale is non-linear in font size.** Smaller fonts wrap
   differently, so content height is not proportional to scale.
   `computeAutofitScale` binary-searches (re-laying-out per probe,
   floor 0.1, ~8 steps), capped at 1.0 (never enlarges past authored
   size — matches GS/PPT).

6. **grow = bidirectional (spAutoFit).** Both GS and PowerPoint shrink
   the box back when text is deleted, not just grow. No `max(originalH)`
   floor — the box tracks content both ways (natural min is one line).

7. **The Mem store is not the only store — the Yorkie (production) store
   has its OWN element-construction code.** This was the biggest miss.
   `MemSlidesStore` (tested) preserves `data` via spreads, but
   `YorkieSlidesStore` (production, `packages/frontend/...`) rebuilds text
   `data` from scratch in THREE places — `addElement`, `addSlide`
   placeholder seeding, and the undo/redo snapshot restore — each as a
   bare `{ blocks }`, dropping `autofit`. Every branch test passed because
   they all run against `MemSlidesStore`; the feature was inert by default
   in production until the final whole-branch review caught it. The
   undo/redo restore path ALSO dropped `placeholderRef` (a pre-existing
   bug, untested because the undo/redo test only used `blank` slides).
   **Rule:** when adding a persisted field, the inventory of "creation
   sites" MUST include the Yorkie store's addElement / addSlide / snapshot
   restore, the Yorkie schema type (`types/slides-document.ts`), AND a
   Mem-vs-Yorkie equivalence assertion for the new field — `stripIds()`
   only compares type/frame, so structural equivalence tests won't catch
   a dropped `data` field.

8. **A parallel feature landed on `main` mid-flight and owned half of
   mine.** While this branch was in review, `slides-textbox-autogrow`
   merged — it implemented the `grow` half (live content-fit height via a
   docs `onContentHeightChange` + `setContentHeight`) in the same five
   files. `git rebase origin/main` surfaced it (a `README.md` conflict was
   the first hint). The fix was a reframe, not a merge: rebuild the branch
   on `main`, cherry-pick the still-clean net-new commits (engine,
   renderer shrink, type, defaults, PPTX import, Yorkie persistence), and
   hand-write the editor/docs wiring to **reuse** main's grow mechanism —
   `grow` now delegates to `onContentHeightChange`, `shrink` adds a new
   `transformLayoutBlocks` hook, and the wrapper gates which fires by mode.
   **Rule:** before a long-lived feature branch, check whether an
   overlapping design doc / PR is already in flight; rebase early and
   often so a parallel merge surfaces while the diff is small.
   **Consequence:** `absent ⇒ grow` (not `none`) so decks created under
   the auto-grow feature keep growing — the default had to follow what
   already shipped.

## Process note

Subagent-driven execution worked well; the two-stage review caught the
Task 4 stamping gap (implementer flagged it; investigation found a
SECOND identical site). Trivial review nits (doc wording, extra test
assertions) were applied inline by the controller rather than spending a
subagent round-trip — faster for one-liners on already-approved code.
