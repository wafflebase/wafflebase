# Slides PPTX Text Vertical Anchor — Lessons

Non-obvious gotchas surfaced while shipping the import + render +
in-place-editor work for `<a:bodyPr anchor>`.

## 1. Click hit-test math is the failure point, not paint

The plan got the **paint** offset right on the first try — measure
`layout.totalHeight`, derive `originY`, pass through `paintLayout`.
But the **click** path lives in a separate code path inside the docs
`TextEditor`, gated by a single callback (`getCanvasOffsetTop`). The
first attempt set it to `-(pageGap + currentOriginY) * scale`, which
double-applies the offset.

Final code-review caught it on the whole-branch pass; unit tests
couldn't reach it because jsdom returns `{top:0, left:0}` for canvas
`getBoundingClientRect`, so a synthetic click can't distinguish the
broken formula from the correct one.

**Correct derivation:** TextEditor computes
`py = (clientY - rect.top - canvasOffsetTop)/scale`, then
`localY = py - pageGap`. For a click at `host-y = originY*scale` to
produce `localY = 0`, solve to `canvasOffsetTop = (originY - pageGap)*scale`.
Reduces to the pre-feature `-pageGap*scale` when `originY = 0`.

**How to apply:** Whenever you add a paint-origin offset to an
interactive surface, derive the inverse for every pointer-driven
input (clicks, drags, hover hit-test, IME composition position) in
the SAME commit. Don't assume jsdom-shaped tests can cover the
inverse — write the algebra in JSDoc above the inverse callback so
future readers can re-verify by inspection.

## 2. `paintLayout` propagates `originY` into cursor + selection internally

The plan's Task 6 initially told the implementer to pre-shift
`cursor.y` and `selectionRect.y` by `+currentOriginY` AND to pass
`originY = currentOriginY` to `paintLayout`. The implementer read
`paint-layout.ts:124,131,139` and discovered `paintLayout` already
adds `originY` to cursor and rect y internally — pre-shifting would
have doubled the offset (the same shape of bug as #1, by coincidence,
in a different code path).

**How to apply:** Read the callee's source before deciding which
side of an interface "owns" a transform. The docstring on
`paintLayout` does not state this contract; only the implementation
does. The plan should have been a hypothesis, not a prescription —
which is what the implementer's escalation surfaced.

## 3. First-render race on closure-captured offset variables

`let currentOriginY = 0;` declared at editor-construction time meant
that a click in the narrow window between `new TextEditor(...)` (which
wires `mousedown` immediately) and the first `requestAnimationFrame`
fire (which would set `currentOriginY`) saw 0 — wrong for any
non-top anchor.

Fix: initialize eagerly after the first `recomputeLayout()`, BEFORE
`new TextEditor(...)`. Also resync inside `setContentHeight`.

**How to apply:** Any closure variable read by an event handler that
is wired at construction time must have its real value at
construction. "It'll get set during the first paint" is not enough
when input handlers fire on user time, not paint time.

## 4. Docs `dist/` staleness blocks cross-package type checks

When `packages/docs/src/view/text-box-editor.ts` gained the new
`verticalAnchor` option, the implementer for the slides wrapper
(Task 7) hit a `tsc` failure on the forwarding line: the slides
package resolves `@wafflebase/docs` against its built `dist/`, which
still had the pre-feature `TextBoxEditorOptions`.

Same gotcha already documented in
`20260525-slides-text-autofit-lessons.md` and
`20260528-slides-shift-modifiers-lessons.md`. Worth restating because
multi-package boundary work hits it every time.

**How to apply:** When a commit modifies a `@wafflebase/docs` public
interface AND a sibling package consumes it in the same branch, the
implementer of the consumer commit must `pnpm --filter @wafflebase/docs build`
before `tsc`. Pre-commit hooks won't do this automatically.

## 5. Offline-but-real smoke is more valuable than a stubbed UI smoke

Task 4 (manual smoke) couldn't reasonably be done via a browser
without login + UI file-upload plumbing. Instead, a temporary vitest
spec imported the real `Yorkie, 캐즘 뛰어넘기.pptx` from disk through
the production `importPptx` entry point and asserted
`slide1.title.data.verticalAnchor === 'bottom'`. The file was deleted
after running (no commit) so the test stayed local-only and didn't
add a flaky `~/Downloads` dependency to CI.

**How to apply:** When a manual smoke target is "does the production
pipeline produce the right data on this specific file", reach for
the production import API in a one-shot test rather than the UI.
Delete the spec after — keep the value proven, skip the maintenance.

## 6. Sparse-write at the model boundary, defined-write at the user-input boundary

The importer writes `verticalAnchor` only when `<a:bodyPr anchor>` is
explicitly set; the menu (Stage 1 follow-up) writes a defined value
for every click. Both are right for their domain — the importer
shouldn't fabricate a default the source didn't carry, and the menu
shouldn't leave the field undefined after the user explicitly chose
"Top" (the next round-trip would re-resolve the default and lose the
explicit intent).

`updateElementData`'s shallow-merge semantics meant this Just Worked
without extra plumbing — writing `{ verticalAnchor: x }` preserves
`autofit`, `blocks`, etc.

**How to apply:** When a field has a "sparse default vs explicit
value" distinction, decide per write site whether to fabricate the
default or not. Importers and migrations should preserve sparseness;
user-facing UI should make intent explicit.
