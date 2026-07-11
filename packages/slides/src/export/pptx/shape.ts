import type { Frame, ShapeElement, ShapeKind, Stroke, TextElement } from '../../model/element.js';
import { pxToEmuX, pxToEmuY, radToRot60k } from './units.js';
import { fillXml, solidFillXml, colorFromStringOrTheme } from './color.js';
import { textBodyToXml } from './text.js';
import { effectsToXml } from './effects.js';
import { freeformToCustGeom } from './freeform.js';
import { arrowXml } from './connector.js';
import { attr, escapeXmlAttr } from './xml.js';

/**
 * Map a `ShapeKind` to the OOXML `prst` attribute value.
 *
 * Most names are identity strings; the one exception is
 * `pentagonArrow` which OOXML exports as `homePlate`.
 */
export function kindToPrst(kind: ShapeKind): string {
  return kind === 'pentagonArrow' ? 'homePlate' : kind;
}

/**
 * Serialize a {@link Frame} to an `<a:xfrm>` element.
 *
 * **Rotation units:** `Frame.rotation` is stored in radians (set by
 * `rotEmuToRad` during PPTX import). `radToRot60k` converts to OOXML
 * 60 000ths-of-a-degree.
 *
 * `flipH` / `flipV` are optional on Frame; omitting them when
 * falsy keeps the attribute list compact and round-trip stable.
 */
export function xfrmXml(frame: Frame): string {
  const rot = frame.rotation ? ` rot="${radToRot60k(frame.rotation)}"` : '';
  const fh = frame.flipH ? ' flipH="1"' : '';
  const fv = frame.flipV ? ' flipV="1"' : '';
  return (
    `<a:xfrm${rot}${fh}${fv}>` +
    `<a:off x="${pxToEmuX(frame.x)}" y="${pxToEmuY(frame.y)}"/>` +
    `<a:ext cx="${pxToEmuX(frame.w)}" cy="${pxToEmuY(frame.h)}"/>` +
    `</a:xfrm>`
  );
}

const DASH_VAL: Record<string, string> = {
  dashed: 'dash',
  dotted: 'sysDot',
};

/**
 * Serialize a {@link Stroke} to an `<a:ln>` element, or `''` if absent.
 *
 * `arrowheads` (freeform line ends) map to `<a:headEnd>`/`<a:tailEnd>`,
 * inverse of the importer — see {@link arrowXml}. Emitted only when a
 * stroke is present, since arrowheads have no meaning without a line.
 */
export function lineXml(
  stroke: Stroke | undefined,
  arrowheads?: ShapeElement['data']['arrowheads'],
): string {
  if (!stroke) return '';
  const w = pxToEmuX(stroke.width);
  const fill = solidFillXml(colorFromStringOrTheme(stroke.color));
  const dash =
    stroke.dash && stroke.dash !== 'solid'
      ? `<a:prstDash val="${DASH_VAL[stroke.dash] ?? 'dash'}"/>`
      : '';
  const head = arrowXml('headEnd', arrowheads?.start);
  const tail = arrowXml('tailEnd', arrowheads?.end);
  return `<a:ln w="${w}">${fill}${dash}${head}${tail}</a:ln>`;
}

/**
 * Serialize a {@link ShapeElement} to a `<p:sp>` element.
 *
 * - Preset geometry uses `<a:prstGeom prst="...">` with an `<a:avLst>`
 *   carrying OOXML-style adjustment values.
 * - `kind === 'freeform'` emits `<a:custGeom>` from the stored path.
 * - Text body uses `<p:txBody>` (the PPTX namespace for shapes), not
 *   `<a:txBody>` (the DrawingML namespace used in table cells).
 * - The `id` attribute on `<p:cNvPr>` is set to `"0"`; the
 *   PPTX-level shape-id is assigned by the slide assembly layer.
 */
export function shapeToXml(el: ShapeElement): string {
  const { data, frame } = el;

  // For freeform with a path → custGeom; freeform without path → rect fallback
  // (prst="freeform" is not valid OOXML and causes PowerPoint to reject the file).
  const geom =
    data.kind === 'freeform' && data.path
      ? freeformToCustGeom(data.path, frame)
      : data.kind === 'freeform'
        ? `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`
        : `<a:prstGeom prst="${kindToPrst(data.kind)}">${avLstXml(data.adjustments)}</a:prstGeom>`;

  const fill = data.fill ? fillXml(data.fill) : '<a:noFill/>';

  const spPr =
    `<p:spPr>` +
    xfrmXml(frame) +
    geom +
    fill +
    // Arrowheads are a freeform-only concept (only freeform import populates
    // them and only freeform rendering draws them); don't emit head/tailEnd
    // onto a parametric shape's line even if the field were somehow set.
    lineXml(data.stroke, data.kind === 'freeform' ? data.arrowheads : undefined) +
    effectsToXml(data.effects) +
    `</p:spPr>`;

  const txBody = data.text
    ? textBodyToXml(data.text, 'p:txBody')
    : `<p:txBody><a:bodyPr/><a:p/></p:txBody>`;

  const descrAttr = attr('descr', data.alt);
  const nv =
    `<p:nvSpPr>` +
    `<p:cNvPr id="0" name="${escapeXmlAttr(el.id)}"${descrAttr}/>` +
    `<p:cNvSpPr/>` +
    `<p:nvPr/>` +
    `</p:nvSpPr>`;

  return `<p:sp>${nv}${spPr}${txBody}</p:sp>`;
}

/**
 * Serialize a {@link TextElement} to a `<p:sp>` element with `txBox="1"`.
 *
 * A text element is a standalone text box — it maps to an OOXML `<p:sp>`
 * with `<p:cNvSpPr txBox="1"/>`. Without the `txBox="1"` marker the
 * PPTX importer would re-read it as a `ShapeElement` (kind: 'rect'), not
 * a `TextElement`, so round-trip type fidelity requires emitting it.
 *
 * Text elements carry no geometry fill (just an optional stroke/fill on the
 * box border), so `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` is used
 * as the mandatory geometry placeholder alongside `<a:noFill/>` (unless an
 * explicit fill is present).
 */
export function textElementToXml(el: TextElement): string {
  const { data, frame } = el;

  const fill = data.fill ? solidFillXml(data.fill) : '<a:noFill/>';

  const spPr =
    `<p:spPr>` +
    xfrmXml(frame) +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    fill +
    lineXml(data.stroke) +
    effectsToXml(data.effects) +
    `</p:spPr>`;

  const txBody = textBodyToXml(
    { blocks: data.blocks, autofit: data.autofit, verticalAnchor: data.verticalAnchor },
    'p:txBody',
  );

  const descrAttr = attr('descr', data.alt);
  const nv =
    `<p:nvSpPr>` +
    `<p:cNvPr id="0" name="${escapeXmlAttr(el.id)}"${descrAttr}/>` +
    `<p:cNvSpPr txBox="1"/>` +
    `<p:nvPr/>` +
    `</p:nvSpPr>`;

  return `<p:sp>${nv}${spPr}${txBody}</p:sp>`;
}

/**
 * Serialize OOXML-style adjustments into an `<a:avLst>`.
 *
 * Each entry becomes a `<a:gd name="adjN" fmla="val NNN"/>` where N
 * is 1-based.  An empty or absent array emits `<a:avLst/>`.
 */
function avLstXml(adj: number[] | undefined): string {
  if (!adj || adj.length === 0) return '<a:avLst/>';
  const gds = adj
    .map((v, i) => `<a:gd name="adj${i + 1}" fmla="val ${Math.round(v)}"/>`)
    .join('');
  return `<a:avLst>${gds}</a:avLst>`;
}
