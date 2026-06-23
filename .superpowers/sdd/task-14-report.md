# Task 14: Model-equivalence round-trip suite — Report

## Files Created

### New test files
- `packages/slides/test/export/pptx/normalize.ts` — test helper: `normalize(deck)` and `fromDataUrl(src)`
- `packages/slides/test/export/pptx/round-trip.test.ts` — 8 round-trip tests (`@vitest-environment jsdom`)
- `packages/slides/test/import/pptx/__fixtures__/build-rich-pptx.ts` — 6-slide fixture covering all element types

### Modified serializer files
- `packages/slides/src/export/pptx/theme.ts` — fix theme name bug
- `packages/slides/src/export/pptx/shape.ts` — add `textElementToXml`
- `packages/slides/src/export/pptx/group.ts` — wire `textElementToXml`

## Fixtures Added

| Fixture | Slide | Element type |
|---------|-------|--------------|
| `buildMinimalPptx()` | 1 | blank slide (pre-existing) |
| `buildRichPptx()` | 1 | `ShapeElement` — roundRect, red fill, "Hello" text |
| `buildRichPptx()` | 2 | `TextElement` — txBox, bold run, grow autofit |
| `buildRichPptx()` | 3 | `TableElement` — 2×2 table, merged header, tableStyleId |
| `buildRichPptx()` | 4 | `ImageElement` — 1×1 PNG, no crop |
| `buildRichPptx()` | 5 | `GroupElement` — group containing a blue rect child |
| `buildRichPptx()` | 6 | `ConnectorElement` — straight connector, green stroke |

## Serializer Fixes

### Fix 1: Theme name hardcoded as `Theme${index}` (theme.ts)
**File:** `packages/slides/src/export/pptx/theme.ts` line 99  
**What was wrong:** The `<a:theme name="...">` attribute was hardcoded to `Theme${index}` instead of using `theme.name`. The color scheme name and font scheme name used the correct `schemeName` variable, but the root element attribute was wrong.  
**Fix:** Changed `Theme${index}` to `schemeName` (which is `escapeXmlAttr(theme.name ?? 'Theme${index}')`).  
**Impact:** Theme name "Office" round-tripped as "Theme1" before the fix.

### Fix 2: TextElement serialized without `txBox="1"` (shape.ts, group.ts)
**File:** `packages/slides/src/export/pptx/shape.ts` + `packages/slides/src/export/pptx/group.ts`  
**What was wrong:** The exporter converted `TextElement` to a synthetic `ShapeElement` (via `textElementAsShape`) and called `shapeToXml`. The emitted `<p:sp>` had `<p:cNvSpPr/>` (no `txBox` attribute). The PPTX importer only creates a `TextElement` when `txBox="1"` is present; without it, the `<p:sp>` with `prst="rect"` and no fill imports as a `ShapeElement` with `kind: 'rect'`.  
**Fix:** Added `textElementToXml(el: TextElement): string` to `shape.ts` that emits `<p:cNvSpPr txBox="1"/>`. Updated `elementToXml` in `group.ts` to call `textElementToXml` for `type === 'text'`. Removed the now-unused `textElementAsShape` helper and the `TextBody` import.  
**Impact:** Text elements round-tripped as `{type:'shape', data:{kind:'rect',...}}` before the fix; they now correctly round-trip as `{type:'text', data:{blocks,...}}`.

## normalize() Exclusions

### IDs zeroed
- `Slide.id` — regenerated on import
- `Element.id` (all types, recursively through group children) — regenerated
- `Block.id` — regenerated
- `SlideAnimation.id` / `.elementId` — regenerated / references zeroed element

### Structural replacements
- `slide.layoutId` → `"layout:N"` positional string (importer generates new layout IDs)
- `meta.themeId`, `meta.masterId` → `''` (generated IDs differ)

### Non-PPTX fields dropped
- `meta.pxPerPt` — computed from slide size; slight float rounding may differ
- `meta.recentColors` — not stored in PPTX
- `guides` → `[]` — not exported to PPTX

### Inherently lossy connector fields
- `connector.start`, `connector.end` → `{ kind: '_normalized' }` — the exporter does not emit `<a:stCxn>`/`<a:endCxn>`, so attached endpoints become free on re-import and free endpoints become computed from the frame corners
- `connector.frame` → `{x:0,y:0,w:0,h:0,rotation:0}` — connector frame is derived from endpoints via `computeConnectorFrame`, which adds stroke-width padding not present in the original PPTX frame; since endpoints are already normalized, the frame is meaningless

### Text-body lossy fields (importer imports these but exporter doesn't serialize them)
- `inline.style.backgroundColor` — imported from `<a:highlight>`, no export path
- `inline.style.href` — imported from `<a:hlinkClick>`, exported as empty `r:id=""` that doesn't resolve on re-import
- `block.style.lineHeight` — imported from `<a:lnSpc>`, not exported
- `block.style.marginLeft` — imported from `<a:pPr marL>`, not exported
- `block.style.textIndent` — imported from `<a:pPr indent>`, not exported
- `block.style.marginTop` — imported from `<a:pPr spcBef>`, not exported
- `block.style.marginBottom` — imported from `<a:pPr spcAft>`, not exported
- `block.marker` — bullet marker style (`buFont`/`buSzPts`/`buClr`) imported; only `buChar`/`buAutoNum` type info is exported, not the full styling object

## Final Test Counts

- Round-trip tests: **8 passed** (minimal, shape, text box, table, image, group, connector, full rich deck)
- Full slides suite: **2248 passed, 2 skipped, 310 test files** — zero regressions

## Element Types That Do Not Fully Round-Trip

| Element | Status | Reason |
|---------|--------|--------|
| `ShapeElement` | ✅ round-trips | Shape, fill, text preserved |
| `TextElement` | ✅ round-trips (after Fix 2) | `txBox="1"` now emitted |
| `TableElement` | ✅ round-trips | gridSpan/hMerge/vMerge, tableStyleId preserved |
| `ImageElement` | ✅ round-trips | bytes preserved via data URL |
| `GroupElement` | ✅ round-trips | children, refSize preserved |
| `ConnectorElement` | ⚠️ partial | routing/stroke/arrowheads preserved; endpoints lost (stCxn/endCxn not emitted); frame normalized away |

---

## Fix: Masked exporter gaps now closed (post-task-14 follow-up)

Four text fields that the importer read but the exporter dropped have been
wired up. The `normalize()` exclusions for these fields have been removed.
A new slide (slide 7 of `buildRichPptx()`) exercises all four fields.

### Field 1: `block.style.lineHeight` → `<a:lnSpc><a:spcPct val="N"/></a:lnSpc>`

**Importer inverse:** `attrInt(spcPct, 'val') / 100_000` → `style.lineHeight`
**Export formula:** `val = Math.round(lineHeight * 100_000)`
**Fixture:** `<a:lnSpc><a:spcPct val="150000"/>` → lineHeight = 1.5
**normalize() change:** `delete s.lineHeight` exclusion removed.

### Field 2: `block.style.marginLeft` / `block.style.textIndent` → `marL` / `indent` on `<a:pPr>`

**Importer inverse:**
- `attrInt(pPr, 'marL') / 9525` → `style.marginLeft` (EMU→px at 96 dpi)
- `attrInt(pPr, 'indent') / 9525` → `style.textIndent`

**Export formula:**
- `marL = Math.round(marginLeft * 9525)` (omit when zero)
- `indent = Math.round(textIndent * 9525)` (omit when zero)

**Fixture:** `<a:pPr marL="457200" indent="-457200">` → marginLeft ≈ 48 px, textIndent ≈ -48 px
**normalize() change:** `delete s.marginLeft` and `delete s.textIndent` exclusions removed.

### Field 3: `inline.style.backgroundColor` → `<a:highlight>`

**Importer inverse:** `parseColorFromContainer(highlight, clrMap)` → `style.backgroundColor`
**Export formula:** `<a:highlight>{colorChildXml(storedColorToThemeColor(backgroundColor))}</a:highlight>`
Uses the same `storedColorToThemeColor` + `colorChildXml` bridge already used for `style.color`.
**Fixture:** `<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>` → backgroundColor = `{kind:'srgb', value:'#FFFF00'}`
**normalize() change:** `delete s.backgroundColor` exclusion removed.

### Field 4: `block.marker` → `<a:buClr>` / `<a:buSzPts>` / `<a:buFont>` inside `<a:pPr>`

**Importer inverse:**
- `<a:buFont typeface="...">` → `marker.fontFamily`
- `<a:buSzPts val="...">` / 100 → `marker.fontSize` (val in hundredths of a point)
- `<a:buClr>` color → `marker.color` (via `parseColorFromContainer`)

**Export formula (OOXML child order: buClr → buSzPts → buFont → buAutoNum/buChar):**
- `<a:buClr>{colorChildXml(storedColorToThemeColor(marker.color))}</a:buClr>`
- `<a:buSzPts val="${Math.round(marker.fontSize * 100)}"/>`
- `<a:buFont typeface="${escapeXmlAttr(marker.fontFamily)}"/>`

Only emitted on list-item blocks (when `block.listKind` is set).
**Fixture:** `<a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPts val="1200"/><a:buFont typeface="Arial"/><a:buChar char="•"/>` → marker = `{color:{kind:'srgb',value:'#FF0000'}, fontSize:12, fontFamily:'Arial'}`
**normalize() change:** `delete block.marker` exclusion removed.

### Remaining exclusions (legitimate)

- `inline.style.href` — v1 deferral: exporter does not yet wire hyperlink relationship ids (requires rel/spid coupling)
- `connector.start`, `connector.end`, `connector.frame` — v1 deferral: exporter does not emit `<a:stCxn>`/`<a:endCxn>`
- `block.style.marginTop`, `block.style.marginBottom` — vacuous: importer never reads `spcBef`/`spcAft`
- IDs, layoutId, meta.themeId/masterId/pxPerPt/recentColors, guides, animations.elementId — structural: regenerated on import

### Test results after fixes

- Round-trip tests: **9 passed** (added slide-7 fixture test + updated full-deck test to 7 slides)
- Full pptx export suite: **140 passed, 15 test files** — zero regressions
