# Shape & connector dashed/dotted strokes never render

Reported against a shared `slides` document: setting a shape's border to
`dotted` in the toolbar changes nothing on screen.

## Root cause

`Stroke.dash` is stored, round-tripped and exported correctly — only the
Canvas painters for **shapes** and **connectors** never read it.

`dashArray()` (`view/canvas/render-context.ts:65`, `dotted → [2,2]`,
`dashed → [6,4]`) has exactly two consumers today:

| Renderer | `ctx.setLineDash` | On-screen result |
| --- | --- | --- |
| `text-renderer.ts:153` | ✅ `dashArray(...)` + reset | correct |
| `table-renderer.ts:314` | ✅ `dashArray(...)` + reset | correct |
| `shape-renderer.ts` | ❌ absent | always solid |
| `connector-renderer.ts` | ❌ absent | always solid |

Proven with a spy-ctx probe: `drawShape()` on a `rect` with
`dash: 'dotted'` calls `ctx.stroke` but calls `ctx.setLineDash` **zero
times**.

Not a data bug — `export/pptx/shape.ts:152` maps `dash` to
`<a:prstDash val="sysDot"/>`, so the same deck exports to PowerPoint as
dotted while rendering solid in the app.

**Correction (from review): the round trip is only half closed.** PPTX
**import** drops `dash` entirely — `parseShapeStroke`
(`import/pptx/shape.ts:971`) reads `<a:ln w>` and `<a:solidFill>` and
returns `{ color, width }`; there is no `prstDash` read anywhere under
`import/`. So a PowerPoint deck with a dashed border imports as solid,
and after this branch it renders solid *correctly*, which is harder to
notice than the bug it replaces. Out of scope here (see Non-goals), but
it is a real follow-up, not a footnote.

**Board is affected too**: it reuses the slides scene engine, and the Miro
importer sets `dash` (`board/src/import/miro/map-items.ts:115`).

## Stroke sites to fix

Enumerate by **branch `drawShape` can take**, not by "stroke calls in
`shape-renderer.ts`" — the first pass used the latter and missed the
action-button early return, which paints in another file. The `KINDS`
table in `stroke-dash.test.ts` is now the registry of these branches.

`shape-renderer.ts`:

- [x] `paintFillStroke()` — main path for every parametric kind + freeform
- [x] 3D/folded silhouette stroke in `drawShape()` — cube/can/bevel/ribbon/scroll
- [x] border-callout leader polyline in `drawShape()`
- [x] `drawPlaceholderRect()` — unknown kinds

`shape-special.ts`:

- [x] `drawActionButton()` — returns before `shape-renderer` strokes anything (found in review)

`connector-renderer.ts`:

- [x] `drawConnector()` — straight / elbow / bezier

## Reset discipline

Every site must restore `setLineDash([])` after stroking, matching
text/table. Two call sites make this load-bearing rather than cosmetic:

- `element-renderer.ts:188` calls `drawConnector` with **no**
  surrounding `save()`/`restore()`, so a leaked pattern reaches every
  element painted after it.
- `drawShape` is followed by `paintShapeText` inside the same save scope
  (`element-renderer.ts:286`), so a leak would dash text
  underline/strikethrough.

## Plan

- [x] Failing tests first (spy ctx): dotted/dashed shape, 3D-face shape, callout leader, placeholder kind, connector — assert pattern set **and** reset
- [x] Implement the five sites
- [x] `pnpm verify:fast` green (enforced by the pre-commit hook)
- [x] Self code review over the branch diff
- [ ] PR

## Follow-up: the picker said it in words

With rendering fixed, the control that sets it is still a text menu —
`Solid / Dashed / Dotted`, and `1px / 2px / 4px…` next to it. Replaced
both with a drawn line.

The preview is fed by the renderer's own `dashArray()` (newly exported
from `@wafflebase/slides`), so it cannot drift from what the canvas
strokes. That is the same guarantee `shape-picker` buys by previewing
through `renderShapeIcon` rather than shipping icon assets — and the
reason to prefer it over Tabler's `IconLineDashed`, whose dash rhythm is
Tabler's, not ours.

SVG rather than canvas: `currentColor` resolves natively, which is
precisely what `shape-picker`'s canvas preview has to work around by
reading `getComputedStyle(canvas).color`.

- [x] `StrokePreview` / `DashPreview` (`toolbar/stroke-preview.tsx`)
- [x] Weight menu draws each weight at its real thickness, carrying the current dash
- [x] Dash menu clamps the previewed weight to 3px — `[2,2]` at 16px reads as a solid bar
- [x] `No border` stays words; it has no line to draw
- [x] Items keep an accessible name via `aria-label` (the SVG is `aria-hidden`)
- [x] `border-picker.test.tsx` — asserts the previews use `dashArray()` values, not lookalikes

## Non-goals

- New dash styles beyond `solid | dashed | dotted`
- Changing the `[6,4]` / `[2,2]` pattern values
- Per-side shape borders (tables already have `CellBorder`)
- The docs/sheets border controls — different models, different pickers

## Known gap

Visual smoke in a running editor is **not** done: the dev browser
session is unauthenticated, and `/d/:id` and `/shared/:token` both sit on
`Loading…` forever without reaching Yorkie (no `AttachDocument` RPC in
the server log) — while `POST /share-links/resolve` and
`POST /auth/yorkie-token/share` both answer `200`. That hang looks like a
separate client-side defect and is not investigated here.

## Review

Reviewed over the full branch diff before pushing. One Important finding
and five Minor, all addressed:

- **Important — a fifth stroke site.** `drawActionButton`
  (`shape-special.ts`) strokes the bevel outline and was missed: the
  eleven `actionButton*` kinds return from `drawShape` before any of the
  four fixed paths, and `BorderPicker` is mounted for them with no kind
  gating. The reported symptom survived there. Fixed, with a row added to
  the `KINDS` table; verified it fails without the fix.
- **Minor — two vacuous assertions.** The "stays continuous" cases used
  `every(...)` over the `setLineDash` calls, which is true of an empty
  array, so they also passed on unfixed code. Added
  `expect(setLineDash).toHaveBeenCalled()`.
- **Minor — a weak clamp assertion.** `Number(null)` is `0`, so a dropped
  `stroke-width` satisfied `<= 3`. Tightened to `toBe(3)`.
- **Minor — stale `dashArray` docstring.** It named two consumers; there
  are now five plus the exported toolbar preview.
- **Minor — PPTX import drops `dash`.** Corrected the claim above; noted
  as a follow-up rather than fixed here.
- **Minor — an absent `dash` left every row unchecked.** Harmless while
  the row said "Solid"; with only a drawn line it told the user nothing.
  Now reads absent as `'solid'`, matching `dashArray()`.

The reviewer independently confirmed three things this branch asserts
rather than leaving them as claims: that Board needs no change of its own
(no renderer in `packages/board/src`), that Tailwind 4.1.3 in this repo
emits `.size-auto`, and that an inline `<svg>` carrying it measures
64×16 in Chromium rather than collapsing.

`drawPlaceholderRect` keeping its own `setLineDash` pair was raised and
deliberately kept: it strokes a rect, not a `Path2D`, so it cannot use
the helper without widening its signature, and as written it mirrors
`paintTextBoxDecorations`.

### Round 2

Found one Important and four Minor. The Important one was a **regression
round 1 introduced**: reading an absent `dash` as `'solid'` was right for
a stroke that carries no dash, but `value` is also `undefined` when there
is no stroke at all — the default for every `filled` insert kind
(`interactions/insert.ts`) and for text boxes. So a freshly inserted
rectangle showed *Solid* checked on a shape with no border, while the
weight menu beside it checked nothing. The two menus describe one border
and now agree: absent reads as no border in the dash menu, and as
`No border` in the weight menu.

- The `borderCallout1` row could not fail on a solid leader — `drawShape`
  strokes that kind twice and finding `[2,2]` once satisfied it. Now
  counts both.
- `toMatch(/size-/)` on `querySelector('svg')` was reaching the **check
  icon**, whose class is `size-4` — the very class the assertion exists
  to rule out. It passed while testing nothing. Now reaches the preview
  through its `<line>` and asserts `size-auto` exactly.
- The dash-pattern assertions compared against the literals `'6 4'` /
  `'2 2'`, which a hardcoded preview would also satisfy. Now compared
  against `dashArray()` itself.
- Preview height was `max(16, width + 8)`, so only the 16px row grew and
  the menu's rhythm broke. Constant now.

Round 2 also verified what round 1 asserted: the three collapsed sites
were byte-identical at `origin/main`; no editor overlay is affected
(every overlay in `view/editor/` is DOM, not canvas — there is no
`setLineDash` in that tree); reflections render into a fresh offscreen
context; and `KINDS` covers all six of `drawShape`'s exits. It also
confirmed the leak this guards against is real in the other direction:
`docs/src/view/paint-layout.ts` only calls `setLineDash` for a
non-solid underline, so a solid one inherits whatever is ambient.

## Known gap: dash patterns are fixed px in user space

`dashArray()` returns px patterns, but OOXML `prstDash` is defined in
*multiples of the line width* (`sysDot` 1:1, `dash` 3:1 — the vocabulary
`export/pptx/shape.ts` already maps into). Two consequences, both
pre-existing for text/table borders and merely extended to more surfaces
here:

- A thick dotted border reads as a solid bar, on the canvas as well as
  in the picker. `DASH_PREVIEW_MAX_WEIGHT` is a workaround for the
  symptom; a `dashArray(dash, width)` that scales with the weight is the
  fix, and would also match PowerPoint.
- The pattern shrinks with the transform. `slide-renderer` sets the ctm
  to `hostWidth / 1920`; in a ~160px slide-strip thumbnail that is
  ≈0.17, so `[2,2]` becomes sub-pixel runs that antialias toward a
  continuous line. Board at low zoom is the same. Expect "dotted looks
  solid in the thumbnail" as the first report against this.

## Follow-ups (not in this branch)

- PPTX import: read `<a:prstDash>` in `parseShapeStroke` so a dashed
  border survives a round trip in both directions.
- Width-relative dash patterns (`dashArray(dash, width)`), which fixes
  the thick-border and low-zoom degradation above and deletes
  `DASH_PREVIEW_MAX_WEIGHT`.
- The `/d/:id` and `/shared/:token` loading hang noted under Known gap.
