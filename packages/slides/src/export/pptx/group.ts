/**
 * PPTX group + element dispatch serializer.
 *
 * `elementToXml` dispatches every element type to its dedicated serializer.
 * `groupToXml` emits a `<p:grpSp>` with the standard OOXML group transform
 * (`<a:xfrm>` with `<a:off>/<a:ext>/<a:chOff>/<a:chExt>`).
 *
 * chOff / chExt semantics (confirmed against src/import/pptx/shape.ts
 * `parseGrpSp` and src/import/pptx/group.ts `composeGroupTransform`):
 *   - Children are stored in group-local coords (0..refSize.w × 0..refSize.h).
 *   - `chOff` = (0, 0) — the local origin is never shifted relative to itself.
 *   - `chExt` = refSize ?? frame.{w,h} — the denominator of the
 *     local-to-world scale. The importer derives scale as ext/chExt, so
 *     setting chExt = refSize and ext = frame.{w,h} reproduces the
 *     original scale factor on re-import.
 *
 * Group effects: the importer deliberately does NOT read `<p:grpSpPr>
 * <a:effectLst>` (see shape.ts:197-200 — "unrenderable, uneditable dead
 * data"), so `GroupElement.data.effects` is never populated from PPTX. We
 * therefore do not export it either; round-trip correctness requires
 * exporting only what the importer reads.
 */
import type { Element, Frame, GroupElement, ImageElement } from '../../model/element.js';
import type { ConnectorElement } from '../../model/connector.js';
import { pxToEmuX, pxToEmuY, radToRot60k } from './units.js';
import { shapeToXml, textElementToXml } from './shape.js';
import { imageToXml } from './image.js';
import { tableToXml } from './table.js';
import { connectorToXml } from './connector.js';
import { escapeXmlAttr } from './xml.js';

export interface ElementXmlCtx {
  /** Resolve the relationship ID for an image element's embedded media. */
  resolveImageRId(el: ImageElement): string;
  /** Compute the bounding frame for a connector (from its start/end endpoints). */
  connectorFrame(el: ConnectorElement): Frame;
  /**
   * Resolve a text run's `href` to a slide-local external relationship ID
   * for `<a:hlinkClick>`. Threaded into every text-bearing serializer
   * (shape, text box, table cell).
   */
  resolveHyperlinkRId(href: string): string;
}

/**
 * Dispatch a single element to its dedicated PPTX serializer.
 *
 * `text` elements are serialized via `textElementToXml` which emits
 * `<p:cNvSpPr txBox="1"/>` — the OOXML marker that causes the importer
 * to reconstruct a `TextElement` (not a `ShapeElement`) on re-import.
 */
export function elementToXml(el: Element, ctx: ElementXmlCtx): string {
  switch (el.type) {
    case 'text':
      return textElementToXml(el, ctx.resolveHyperlinkRId);
    case 'shape':
      return shapeToXml(el, ctx.resolveHyperlinkRId);
    case 'image':
      return imageToXml(el, ctx.resolveImageRId(el));
    case 'table':
      return tableToXml(el, ctx.resolveHyperlinkRId);
    case 'connector':
      return connectorToXml(el, ctx.connectorFrame(el));
    case 'group':
      return groupToXml(el, ctx);
    case 'chart':
      // Chart PPTX serialization is Phase 2. Skip rather than abort the
      // whole deck — omitting one element still lets the rest export.
      return '';
  }
}

/**
 * Serialize a {@link GroupElement} to a `<p:grpSp>` element.
 *
 * The OOXML group transform carries four boxes:
 *   `<a:off>`   — group position in the parent (world) coordinate space
 *   `<a:ext>`   — group size in the parent (world) coordinate space
 *   `<a:chOff>` — local-space origin (always 0, 0 in our model)
 *   `<a:chExt>` — local-space extent = refSize (the denominator for child scaling)
 *
 * Children are recursed through `elementToXml`, which handles arbitrary
 * nesting depth.
 */
export function groupToXml(el: GroupElement, ctx: ElementXmlCtx): string {
  const { frame, data } = el;
  const ref = data.refSize ?? { w: frame.w, h: frame.h };

  const rot = frame.rotation ? ` rot="${radToRot60k(frame.rotation)}"` : '';
  const fh = frame.flipH ? ' flipH="1"' : '';
  const fv = frame.flipV ? ' flipV="1"' : '';
  const xfrm =
    `<a:xfrm${rot}${fh}${fv}>` +
    `<a:off x="${pxToEmuX(frame.x)}" y="${pxToEmuY(frame.y)}"/>` +
    `<a:ext cx="${pxToEmuX(frame.w)}" cy="${pxToEmuY(frame.h)}"/>` +
    `<a:chOff x="0" y="0"/>` +
    `<a:chExt cx="${pxToEmuX(ref.w)}" cy="${pxToEmuY(ref.h)}"/>` +
    `</a:xfrm>`;

  const nv =
    `<p:nvGrpSpPr>` +
    `<p:cNvPr id="0" name="${escapeXmlAttr(el.id)}"/>` +
    `<p:cNvGrpSpPr/>` +
    `<p:nvPr/>` +
    `</p:nvGrpSpPr>`;

  const children = data.children.map((c) => elementToXml(c, ctx)).join('');

  return `<p:grpSp>${nv}<p:grpSpPr>${xfrm}</p:grpSpPr>${children}</p:grpSp>`;
}
