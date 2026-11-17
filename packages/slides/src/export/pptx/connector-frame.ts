import type { ConnectorElement } from '../../model/connector.js';
import type { Element, Frame } from '../../model/element.js';
import {
  computeConnectorFrame,
  resolveEndpoint,
} from '../../view/canvas/connector-frame.js';

/**
 * The `<a:xfrm>` box of a connector for PPTX export: the rendered path's
 * bounding box (without the stroke padding the canvas frame carries), plus
 * `flipH` / `flipV` when the start endpoint lies right of / below the end.
 *
 * OOXML draws a connector from its box's top-left to its bottom-right and
 * mirrors that by the flips; the importer resolves free endpoints the same
 * way (`resolveEndpoint` in `import/pptx/shape.ts`). The bbox alone loses
 * the direction, so an arrow drawn right-to-left came back pointing
 * left-to-right.
 */
export function connectorExportFrame(
  el: ConnectorElement,
  lookup: ReadonlyMap<string, Element>,
): Frame {
  const padded = computeConnectorFrame(el, lookup);
  // `computeConnectorFrame` pads the box by half the stroke width so the
  // canvas stroke stays inside the cached frame. OOXML draws the line
  // corner to corner of `<a:ext>`, so the pad would tilt a horizontal
  // connector by its stroke width; export the path's own bounds.
  const pad = (el.stroke?.width ?? 1) / 2;
  const frame: Frame = {
    x: padded.x + pad,
    y: padded.y + pad,
    w: Math.max(0, padded.w - pad * 2),
    h: Math.max(0, padded.h - pad * 2),
    rotation: 0,
  };
  const a = resolveEndpoint(el.start, lookup);
  const b = resolveEndpoint(el.end, lookup);
  // A sub-pixel difference is a straight horizontal/vertical line; flipping
  // it would only churn the XML.
  const flipH = a.x - b.x > 0.5;
  const flipV = a.y - b.y > 0.5;
  return {
    ...frame,
    ...(flipH ? { flipH: true } : {}),
    ...(flipV ? { flipV: true } : {}),
  };
}
