import { BUILT_IN_LAYOUTS } from '../../model/layout';
import type { Layout } from '../../model/presentation';
import { ImportReport } from './report';
import { attr, descendant, parseXml } from './xml';

/**
 * OOXML `<p:sldLayout type>` value → one of our built-in layout ids.
 *
 * PPTX defines ~30 layout `type` tokens; we collapse them onto the 11
 * Google-Slides-parity layouts shipped in v0.4.0. Any unrecognised
 * token falls back to `title-body` (the most common one in real decks)
 * and bumps `report.unknownLayoutTypes`.
 *
 * The benchmark Yorkie 캐즘 deck uses only `tx`, `secHead`, `body`, and
 * `title` — all covered explicitly below.
 */
const TYPE_TO_BUILT_IN: Record<string, string> = {
  title: 'title-slide',
  ctrTitle: 'title-slide',
  secHead: 'section-header',
  obj: 'title-body',
  tx: 'title-body',
  body: 'one-column-text',
  titleOnly: 'title-only',
  twoColTx: 'title-two-columns',
  twoObj: 'title-two-columns',
  twoTxTwoObj: 'title-two-columns',
  blank: 'blank',
};

export interface ImportedLayout {
  /** Stable id for this layout part — used by slide rels resolution. */
  ooxmlPartName: string;
  /** Built-in layout id that best matches the OOXML `type`. */
  layout: Layout;
}

/**
 * Resolve a `ppt/slideLayouts/slideLayoutN.xml` document to one of our
 * eleven built-in layouts. v1 does *not* synthesise per-deck custom
 * layouts; the design doc reserves that for v1.5 alongside theme builder
 * editing of master/layout placeholders.
 */
export function parseLayout(
  xml: string,
  ooxmlPartName: string,
  report: ImportReport,
): ImportedLayout {
  const doc = parseXml(xml);
  const sldLayout = descendant(doc, 'sldLayout');
  const rawType = sldLayout ? attr(sldLayout, 'type') : undefined;
  const builtInId = rawType ? TYPE_TO_BUILT_IN[rawType] : undefined;

  if (rawType && !builtInId) report.unknownLayoutTypes += 1;

  const targetId = builtInId ?? 'title-body';
  const layout = BUILT_IN_LAYOUTS.find((l) => l.id === targetId) ?? BUILT_IN_LAYOUTS[0];

  return { ooxmlPartName, layout };
}
