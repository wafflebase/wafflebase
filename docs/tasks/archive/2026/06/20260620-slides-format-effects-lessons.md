# Slides Format effects — lessons

## PPTX import slice (shadow / reflection / alt + recolor / adjustments)

- **Map import targets to what actually renders, not just what the model
  has a field for.** `GroupElement.data.effects` and `TableElement.data`
  exist, but the element renderer applies drop shadow / reflection to
  single-silhouette leaves only (shape / image / text), and the Format
  panel routes effects accordingly. Importing group/table effects would
  have written unrenderable, uneditable data. Checked `element-renderer.ts`
  + `pick-sections.ts` before deciding which types to wire.

- **Shadow opacity lives in one place.** The renderer's `colorWithAlpha`
  reads `DropShadow.opacity` and ignores any alpha embedded in the color,
  while `resolveColor` bakes a sub-1 `ThemeColor.alpha` into an `rgba()`
  string that then bypasses opacity. Strip the color's alpha into the
  dedicated `opacity` field on import so the two paths don't fight.

- **A shared parser feeding multiple models leaks fields.** `parseBlipFill`
  is used by both `<p:pic>` foreground images and slide/master backgrounds.
  Adding `recolor/brightness/contrast` to `ParsedBlip` silently leaked them
  onto `Background.image` (variable assignment skips excess-property checks)
  — and the shared `drawImage` renderer would have filtered the whole-slide
  background. Project down to the declared shape (`toBackgroundImage`) at the
  background call sites.

- **A deleted `ImportReport` field can break another package invisibly.**
  Removing `report.shadowsDropped` compiled locally because `@wafflebase/cli`
  resolves slides through its gitignored `dist/`, which still had the field.
  `pnpm verify:fast` (no build) stayed green; the break only appears after
  `pnpm --filter @wafflebase/slides build` + CLI `tsc`. When deleting a
  cross-package public field, grep ALL packages and rebuild the dep before
  trusting the typecheck. This was the highest-severity review finding.

- **Attach a host's effect to the silhouette, not every emitted element.**
  A blip-fill-with-caption `<p:sp>` becomes `[image, text]`; attaching the
  parsed effects/alt to all of them double-cast the shadow and duplicated
  alt. The first emitted element is the silhouette in every parseSp branch,
  so attach to `sps[0]` only.

- **OOXML units cheat-sheet used here:** `dir` = 60000ths/deg
  (`rotEmuToRad`), `dist`/`blurRad`/reflection `dist` = EMU (`emuToStrokePx`,
  deck-scaled), `<a:alpha>`/`stA`/`endPos`/`<a:lum bright|contrast>` =
  thousandths-of-percent (`/100000`).
