import {
  computeLayout,
  paginateLayout,
  resolvePageSetup,
  getEffectiveDimensions,
  type Document,
  type PaginatedLayout,
  type TextMeasurer,
} from '@wafflebase/docs';

/**
 * Run `computeLayout` + `paginateLayout` for a fetched `Document` using
 * the supplied measurer. The CLI calls this only when `--pages` is set
 * (or any other flag that needs page boundaries) — the bare `docs
 * content` JSON path skips pagination entirely.
 *
 * Page setup falls back to `DEFAULT_PAGE_SETUP` (US Letter portrait, 1in
 * margins) when the document doesn't carry one. Content width is the
 * effective page width minus left/right margins, matching what the
 * editor's `DocCanvas` computes.
 */
export function paginateForCli(
  doc: Document,
  measurer: TextMeasurer,
): PaginatedLayout {
  const pageSetup = resolvePageSetup(doc.pageSetup);
  const { width: paperWidth } = getEffectiveDimensions(pageSetup);
  const contentWidth =
    paperWidth - pageSetup.margins.left - pageSetup.margins.right;
  const { layout } = computeLayout(
    doc.blocks, measurer, contentWidth, undefined, undefined, undefined, doc.styles,
  );
  return paginateLayout(layout, pageSetup);
}
