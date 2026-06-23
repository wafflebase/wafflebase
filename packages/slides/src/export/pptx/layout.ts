import type { Layout } from '../../model/presentation.js';
import { escapeXmlAttr } from './xml.js';

/**
 * Built-in layout id → OOXML `<p:sldLayout type>` value.
 *
 * This is the inverse of `import/pptx/layout.ts` `TYPE_TO_BUILT_IN`.
 * The importer maps many-to-one (multiple OOXML types collapse to one
 * built-in id); the exporter picks the canonical primary type so that a
 * round-trip `export → import` re-derives the same built-in layout id.
 *
 * Canonical mapping (first/most-common type for each built-in):
 *   title-slide        ← title  (ctrTitle also maps here; title is primary)
 *   section-header     ← secHead
 *   title-body         ← obj    (tx/body also map here; obj is OOXML primary)
 *   title-two-columns  ← twoColTx
 *   title-only         ← titleOnly
 *   one-column-text    ← body
 *   blank              ← blank
 *   main-point, section-title-description, caption, big-number
 *                      → no exact OOXML token; use 'blank' so a re-import
 *                        still produces a valid layout rather than crashing.
 */
const BUILT_IN_TO_TYPE: Record<string, string> = {
  'title-slide': 'title',
  'section-header': 'secHead',
  'title-body': 'obj',
  'title-two-columns': 'twoColTx',
  'title-only': 'titleOnly',
  'one-column-text': 'body',
  'blank': 'blank',
  // Wafflebase-specific layouts with no exact OOXML equivalent — use the
  // closest approximation so the importer still produces a valid result:
  //   main-point, caption, big-number → 'blank'
  //   section-title-description       → 'obj' (title+body is the closest match)
  'main-point': 'blank',
  'section-title-description': 'obj',
  'caption': 'blank',
  'big-number': 'blank',
};

/**
 * Serialize a `Layout` to `ppt/slideLayouts/slideLayoutN.xml` content.
 *
 * Emits the OOXML `type` attribute so that `import/pptx/layout.ts`
 * `parseLayout` can re-derive the same built-in layout id on round-trip.
 *
 * v1 scope: only the layout shell is emitted — no placeholder shapes in
 * `<p:spTree>`. Placeholder geometry is derived from BUILT_IN_LAYOUTS at
 * import time, not from the XML.
 */
export function layoutToXml(layout: Layout, index: number): string {
  const ooxmlType = BUILT_IN_TO_TYPE[layout.id] ?? 'blank';
  const nameAttr = escapeXmlAttr(layout.name ?? `Layout${index}`);

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sldLayout` +
    ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    ` type="${ooxmlType}"` +
    `>` +
    `<p:cSld name="${nameAttr}">` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `</p:sldLayout>`
  );
}
