import type { Frame } from '../../model/element.js';
import type { ArrowheadStyle, ConnectorElement, ConnectorRouting } from '../../model/connector.js';
import { pxToEmu, pxToEmuX, pxToEmuY } from './units.js';
import { solidFillXml, colorFromStringOrTheme } from './color.js';
import { escapeXmlAttr } from './xml.js';

/**
 * `ConnectorElement.routing` → OOXML `<a:prstGeom prst>`.
 *
 * A `Map` (and read with an explicit fallback below) because `routing` is
 * persisted JSON like every other attribute source here: an object lookup
 * would resolve `constructor` through the prototype chain straight into the
 * `prst` attribute, and an unknown own key would emit `prst="undefined"`.
 */
const ROUTING_PRST = new Map<ConnectorRouting, string>([
  ['straight', 'line'],
  ['elbow', 'bentConnector3'],
  ['curved', 'curvedConnector3'],
]);

/**
 * Map ArrowheadKind to the OOXML `type` attribute for `<a:headEnd>`/`<a:tailEnd>`.
 *
 * Inverse of the importer's `OOXML_ARROW_TO_KIND` in import/pptx/shape.ts:
 *   triangle  → 'triangle'
 *   arrow     → 'triangle-open'   (we export triangle-open as 'stealth' to
 *   stealth   → 'triangle'         preserve round-trip: stealth also imports
 *                                   as 'triangle', so we prefer 'triangle'
 *                                   for that kind and use 'stealth' for
 *                                   'triangle-open')
 *   diamond   → 'diamond'
 *   oval      → 'circle'
 *
 * Kinds without a distinct OOXML type (`diamond-open`, `circle-open`,
 * `square`, `square-open`) fall back to the closest available OOXML value
 * so they round-trip to the nearest-match kind.
 *
 * A `Map`, not an object literal: `arrowheads.start.kind` is persisted JSON
 * that the content PUT API lets a caller set to any string, and an object
 * lookup consults the prototype chain — a kind of `constructor` would resolve
 * to an inherited `Object.prototype` member, survive the `?? 'triangle'`
 * fallback and be stringified into the `type` attribute. `Map.get` only ever
 * returns an own entry.
 */
const KIND_TO_OOXML = new Map<string, string>([
  ['triangle', 'triangle'],
  ['triangle-open', 'stealth'],
  ['diamond', 'diamond'],
  ['diamond-open', 'diamond'],
  ['circle', 'oval'],
  ['circle-open', 'oval'],
  ['square', 'oval'],
  ['square-open', 'oval'],
]);

/**
 * Map ArrowheadStyle size to the OOXML `w`/`len` attribute value.
 *
 * The importer reads `len` first (falling back to `w`), so we emit both
 * attributes with the same value for a faithful round-trip.
 *
 * A `Map` for the same prototype-chain reason as {@link KIND_TO_OOXML}.
 */
const SIZE_TO_OOXML = new Map<string, string>([
  ['sm', 'sm'],
  ['md', 'med'],
  ['lg', 'lg'],
]);

export function arrowXml(tag: 'headEnd' | 'tailEnd', a: ArrowheadStyle | undefined): string {
  if (!a) return '';
  const type = KIND_TO_OOXML.get(a.kind) ?? 'triangle';
  const sz = SIZE_TO_OOXML.get(a.size) ?? 'med';
  return `<a:${tag} type="${type}" w="${sz}" len="${sz}"/>`;
}

/**
 * Serialize a {@link ConnectorElement} to an OOXML `<p:cxnSp>` string.
 *
 * The caller (slide orchestrator) computes `frame` via `computeConnectorFrame`
 * and passes it in; connectors store `start`/`end` endpoints, not a bounding
 * frame directly.
 *
 * Round-trip fidelity:
 * - `routing` → `<a:prstGeom prst>` via ROUTING_PRST
 * - `stroke.color` → `<a:solidFill>` inside `<a:ln>` (importer reads this)
 * - `stroke.width` → `<a:ln w>` in EMU (uniform px→EMU via pxToEmu)
 * - `arrowheads.start` → `<a:headEnd>`, `arrowheads.end` → `<a:tailEnd>`
 * - arrowhead `type` inverts `OOXML_ARROW_TO_KIND` from the importer
 * - arrowhead `len`+`w` both emitted (importer reads `len` first)
 */
export function connectorToXml(el: ConnectorElement, frame: Frame): string {
  const prst = ROUTING_PRST.get(el.routing) ?? 'line';
  const name = escapeXmlAttr(el.id);

  const xfrm =
    `<a:xfrm>` +
    `<a:off x="${pxToEmuX(frame.x)}" y="${pxToEmuY(frame.y)}"/>` +
    `<a:ext cx="${pxToEmuX(frame.w)}" cy="${pxToEmuY(frame.h)}"/>` +
    `</a:xfrm>`;

  // Build <a:ln>: width + optional solidFill (stroke color) + arrowheads.
  // Importer's parseShapeStroke reads solidFill inside <a:ln> — must emit it
  // when present so the color round-trips.
  const stroke = el.stroke;
  const lnW = stroke ? pxToEmu(stroke.width) : pxToEmu(1);
  const fillXml = stroke ? solidFillXml(colorFromStringOrTheme(stroke.color)) : '';
  const headXml = arrowXml('headEnd', el.arrowheads.start);
  const tailXml = arrowXml('tailEnd', el.arrowheads.end);
  const ln = `<a:ln w="${lnW}">${fillXml}${headXml}${tailXml}</a:ln>`;

  const nv =
    `<p:nvCxnSpPr>` +
    `<p:cNvPr id="0" name="${name}"/>` +
    `<p:cNvCxnSpPr/>` +
    `<p:nvPr/>` +
    `</p:nvCxnSpPr>`;

  const spPr =
    `<p:spPr>` +
    xfrm +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    ln +
    `</p:spPr>`;

  return `<p:cxnSp>${nv}${spPr}</p:cxnSp>`;
}
