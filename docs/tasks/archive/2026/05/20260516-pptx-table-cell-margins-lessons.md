# Lessons — PPTX import: honor table cell margins

- **PPTX omits cell margins when they match the spec default**, which is
  why "no `<a:tcPr>` margins on benchmark cells" is the common case —
  not a sign the deck is unusual. Fallback to ECMA-376 defaults (91440
  EMU L/R, 45720 EMU T/B) is mandatory, not optional polish.
- **Guard `attrInt(parent, name)` against `parent === undefined`.** Our
  XML helper signature insists on a non-null `Element`, so chain a
  short-circuit (`tcPr && attrInt(tcPr, 'marL')`) rather than passing
  through. Easy to miss when `<a:tcPr>` itself is absent.
- **Stale workspace dist/ surfaces as "missing export" errors.** During
  `pnpm verify:fast`, frontend tests blew up with
  `'computeConnectorFrame' is not exported from @wafflebase/slides`
  and `Property 'getSelectionStyle' does not exist on type
  'TextBoxEditorAPI'`. Both are symptoms of a stale `dist/` on a
  workspace dependency. Fix order: rebuild `@wafflebase/docs` first
  (TextBoxEditorAPI lives there), then `@wafflebase/slides`. The
  on-disk sequence matters because slides' typecheck consumes docs'
  built `.d.ts`.
- **pnpm can leave a workspace dep unlinked.** `jszip` was present in
  the pnpm store but not symlinked into `packages/slides/node_modules`,
  so the slides build (and the two jszip-using tests) failed until a
  fresh `pnpm install`. Worth checking before chasing build-config
  issues.
- **Auditing a 36-slide deck via puppeteer:** the shared link's
  thumbnail panel does respond to `click()`, but only when the click
  fires the mousedown→mouseup→click sequence via `dispatchEvent`,
  not via the plain `element.click()` shortcut. Use a small helper
  installed on `window` once and reuse it across navigations.
- **Look for issues in the cell's TEXT frame, not just visual
  output.** Dumping `frame.x/w` for adjacent cells made the missing
  margin instantly obvious (cell A right-edge equal to cell B left-edge
  → guaranteed visual touch). Worth a one-off node script even when a
  fix is "clear" — confirms the diagnosis before you commit code.
