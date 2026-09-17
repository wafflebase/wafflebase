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

**Board is affected too**: it reuses the slides scene engine, and the Miro
importer sets `dash` (`board/src/import/miro/map-items.ts:115`).

## Stroke sites to fix

`shape-renderer.ts` — four independent stroke paths, all missing it:

- [ ] `paintFillStroke()` (`:403`) — main path for every parametric kind + freeform
- [ ] 3D/folded silhouette stroke in `drawShape()` (`:221`) — cube/can/bevel/ribbon/scroll
- [ ] border-callout leader polyline in `drawShape()` (`:239`)
- [ ] `drawPlaceholderRect()` (`:421`) — unknown kinds

`connector-renderer.ts`:

- [ ] `drawConnector()` (`:33`) — straight / elbow / bezier

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

- [ ] Failing tests first (spy ctx): dotted/dashed shape, 3D-face shape, callout leader, placeholder kind, connector — assert pattern set **and** reset
- [ ] Implement the five sites
- [ ] `pnpm verify:fast` green
- [ ] Self code review over the branch diff
- [ ] PR

## Non-goals

- New dash styles beyond `solid | dashed | dotted`
- Changing the `[6,4]` / `[2,2]` pattern values
- Per-side shape borders (tables already have `CellBorder`)

## Review

_(filled in before merge)_
