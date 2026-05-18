import type {
  Element as SlideElement,
  GroupElement,
  PlaceholderRef,
  PlaceholderType,
  ShapeElement,
  ShapeStroke,
  TextElement,
} from '../../model/element';
import { generateId } from '../../model/element';
import { combinedBoundingBox } from '../../model/frame';
import type {
  ArrowheadKind,
  ArrowheadStyle,
  ConnectorElement,
  ConnectorRouting,
  Endpoint,
} from '../../model/connector';
import { parseColorFromContainer, type ClrMap } from './color';
import type { EmuScale } from './geometry';
import { emuToStrokePx, parseXfrm, prstToShapeKind } from './geometry';
import {
  applyGroupTransform,
  applyGroupTransformToPoint,
  composeGroupTransform,
  IDENTITY_TRANSFORM,
  type GroupTransform,
} from './group';
import { parsePic, type ImageParseContext } from './image';
import { ImportReport } from './report';
import { parseTable } from './table';
import { parseTextBody } from './text';
import type { PptxArchive } from './unzip';
import type { PptxRel } from './rels';
import type { UploadImage } from './index';
import { attr, attrInt, child, children, NS, parseXml } from './xml';

/**
 * Per-slide context plumbed through every element-level parser.
 */
export interface SlideParseContext {
  archive: PptxArchive;
  slidePartPath: string;
  rels: Map<string, PptxRel>;
  uploadImage?: UploadImage;
  scale: EmuScale;
  report: ImportReport;
  /**
   * Maps PPTX shape ids (the `<p:cNvPr id>` numbers within this slide)
   * to the element ids we generated for them. Connectors use this to
   * resolve `<a:stCxn id idx>` / `<a:endCxn id idx>` to attached
   * endpoints.
   */
  idMap: Map<number, string>;
  /**
   * Default font sizes per layout placeholder, keyed by `"{ooxmlType}:{idx}"`.
   * Slide-level runs whose `<a:rPr>` lacks an explicit `sz` inherit from
   * here when the parent shape has a matching `<p:ph>` reference.
   */
  placeholderSizes: Map<string, number>;
  /**
   * Master-level `<p:clrMap>` — applied when resolving slide-level
   * `<a:schemeClr>` lookups so logical names like `bg2` route through
   * the master's translation table.
   */
  clrMap: ClrMap;
}

/**
 * Walk a `<p:spTree>` (or `<p:grpSp>` children) in two passes:
 *   Pass 1: assign element ids to every shape so connectors can resolve
 *           attached endpoints regardless of source order.
 *   Pass 2: parse each child, preserving `<p:grpSp>` as `GroupElement`.
 *
 * Each `<p:grpSp>` becomes a `GroupElement` whose frame is the
 * rotation-aware AABB of its children's world frames (matching the
 * invariant used by `MemSlidesStore.group()` / `YorkieSlidesStore.group()`).
 * Children are stored in group-local coordinates relative to the AABB
 * origin: `child.local = { ...child.world, x: child.world.x - aabb.x,
 * y: child.world.y - aabb.y }`.
 *
 * This correctly handles cases where `<a:chOff>` ≠ `<a:off>` (the old
 * `<a:ext>` approach left children rendering outside the handle), and
 * ensures the selection handle tightly bounds visible content regardless
 * of child rotation.
 */
export async function parseSpTree(
  spTree: Element,
  ctx: SlideParseContext,
  transform: GroupTransform = IDENTITY_TRANSFORM,
): Promise<SlideElement[]> {
  // Pass 1: id assignment for `<p:sp>` / `<p:pic>` / `<p:cxnSp>`,
  // recursing through `<p:grpSp>` so nested ids land in the same map
  // and connectors can resolve attached endpoints regardless of depth.
  preassignIds(spTree, ctx.idMap);

  // Pass 2: parse each child element, preserving groups as GroupElement.
  const out: SlideElement[] = [];
  for (let i = 0; i < spTree.childNodes.length; i++) {
    const n = spTree.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;

    if (el.localName === 'grpSp') {
      const group = await parseGrpSp(el, ctx, transform);
      if (group) out.push(group);
      continue;
    }

    const parsed = await parseChild(el, ctx);
    if (!parsed) continue;
    for (const elem of parsed) {
      out.push(applyTransformToElement(elem, transform));
    }
  }
  return out;
}

/**
 * Parse a `<p:grpSp>` element into a `GroupElement`.
 *
 * The group's frame is set to the rotation-aware AABB of all children's
 * world frames. Children are stored in group-local coords by subtracting
 * the AABB origin: `local.x = world.x - aabb.x`, `local.y = world.y - aabb.y`.
 * Connector free endpoints are translated the same way.
 *
 * This matches the invariant used by `MemSlidesStore.group()` and
 * `YorkieSlidesStore.group()` — the selection handle always tightly bounds
 * the visible content, even when `<a:chOff>` ≠ `<a:off>` or children carry
 * their own rotation.
 *
 * Empty group fallback: if there are no children, fall back to the
 * `<a:off>/<a:ext>` frame so the group still has a sensible position.
 */
async function parseGrpSp(
  grpSp: Element,
  ctx: SlideParseContext,
  parentTransform: GroupTransform,
): Promise<GroupElement | undefined> {
  const grpSpPr = child(grpSp, 'grpSpPr');
  const xfrm = grpSpPr ? child(grpSpPr, 'xfrm') : undefined;
  if (!xfrm) return undefined;

  // Compose the full transform to produce world frames for children.
  const childWorldTransform = composeGroupTransform(parentTransform, grpSp, ctx.scale);

  // Recurse into children; they come back in world coordinates.
  const worldChildren = await parseSpTreeChildren(grpSp, ctx, childWorldTransform);

  // Compute the rotation-aware AABB of all children's world frames.
  // This is the canonical group frame: tightly bounds visible content.
  const aabb = combinedBoundingBox(worldChildren.map((c) => c.frame));

  // Fall back to <a:off>/<a:ext> for empty groups so they still have a position.
  let groupWorldFrame: GroupElement['frame'];
  if (!aabb) {
    const localFrame = parseXfrm(xfrm, ctx.scale);
    groupWorldFrame =
      parentTransform === IDENTITY_TRANSFORM
        ? localFrame
        : applyGroupTransform(localFrame, parentTransform);
  } else {
    groupWorldFrame = { ...aabb, rotation: 0 };
  }

  const groupId = generateId();
  const groupElement: GroupElement = {
    id: groupId,
    type: 'group',
    frame: groupWorldFrame,
    data: {
      children: [],
      // Anchor the local coordinate space at import time so that future
      // resizes scale children proportionally (OOXML chExt/ext semantics).
      refSize: aabb
        ? { w: aabb.w, h: aabb.h }
        : { w: groupWorldFrame.w, h: groupWorldFrame.h },
    },
  };

  // Convert each child's world frame to group-local by subtracting the AABB origin.
  // Rotation and size are unchanged; only (x, y) shift by the AABB origin.
  const ox = groupWorldFrame.x;
  const oy = groupWorldFrame.y;
  const localChildren: SlideElement[] = worldChildren.map((c) =>
    worldToGroupLocal(c, ox, oy),
  );

  groupElement.data.children = localChildren;
  return groupElement;
}

/**
 * Convert a child element's world frame to group-local by subtracting the
 * AABB origin `(ox, oy)`. Rotation and size are preserved unchanged.
 * For connectors, `free` endpoint coordinates are shifted the same way.
 */
function worldToGroupLocal(
  elem: SlideElement,
  ox: number,
  oy: number,
): SlideElement {
  const localFrame = { ...elem.frame, x: elem.frame.x - ox, y: elem.frame.y - oy };
  if (elem.type === 'connector') {
    const start =
      elem.start.kind === 'free'
        ? { kind: 'free' as const, x: elem.start.x - ox, y: elem.start.y - oy }
        : elem.start;
    const end =
      elem.end.kind === 'free'
        ? { kind: 'free' as const, x: elem.end.x - ox, y: elem.end.y - oy }
        : elem.end;
    return { ...elem, frame: localFrame, start, end };
  }
  return { ...elem, frame: localFrame };
}

/**
 * Walk the immediate children of `spTree` (or a `<p:grpSp>`) without the
 * pre-assignment pass — used when recursing from `parseGrpSp` where ids
 * have already been pre-assigned at the top-level `parseSpTree` call.
 */
async function parseSpTreeChildren(
  spTree: Element,
  ctx: SlideParseContext,
  transform: GroupTransform,
): Promise<SlideElement[]> {
  const out: SlideElement[] = [];
  for (let i = 0; i < spTree.childNodes.length; i++) {
    const n = spTree.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;

    if (el.localName === 'grpSp') {
      const group = await parseGrpSp(el, ctx, transform);
      if (group) out.push(group);
      continue;
    }

    const parsed = await parseChild(el, ctx);
    if (!parsed) continue;
    for (const elem of parsed) {
      out.push(applyTransformToElement(elem, transform));
    }
  }
  return out;
}

function applyTransformToElement(
  elem: SlideElement,
  transform: GroupTransform,
): SlideElement {
  if (transform === IDENTITY_TRANSFORM) return elem;
  if (elem.type === 'connector') {
    // Connectors with `attached` endpoints inherit positions from the
    // referenced element — only the `free` corners + arrowhead frame
    // need a transform pass.
    const start =
      elem.start.kind === 'free'
        ? {
            kind: 'free' as const,
            ...applyGroupTransformToPoint(elem.start.x, elem.start.y, transform),
          }
        : elem.start;
    const end =
      elem.end.kind === 'free'
        ? {
            kind: 'free' as const,
            ...applyGroupTransformToPoint(elem.end.x, elem.end.y, transform),
          }
        : elem.end;
    return {
      ...elem,
      frame: applyGroupTransform(elem.frame, transform),
      start,
      end,
    };
  }
  return { ...elem, frame: applyGroupTransform(elem.frame, transform) };
}

function preassignIds(parent: Element, idMap: Map<number, string>): void {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    switch (el.localName) {
      case 'sp':
      case 'pic':
      case 'cxnSp': {
        const id = pptxIdOf(el);
        if (id != null && !idMap.has(id)) idMap.set(id, generateId());
        break;
      }
      case 'grpSp':
        preassignIds(el, idMap);
        break;
    }
  }
}

async function parseChild(
  el: Element,
  ctx: SlideParseContext,
): Promise<SlideElement[] | undefined> {
  switch (el.localName) {
    case 'sp': {
      const sps = parseSp(el, ctx);
      return sps.length > 0 ? sps : undefined;
    }
    case 'pic': {
      const picCtx: ImageParseContext = {
        archive: ctx.archive,
        slidePartPath: ctx.slidePartPath,
        rels: ctx.rels,
        uploadImage: ctx.uploadImage,
        scale: ctx.scale,
        report: ctx.report,
      };
      const img = await parsePic(el, picCtx);
      return img ? [withId(img, ctx, el)] : undefined;
    }
    case 'cxnSp': {
      const cxn = parseCxnSp(el, ctx);
      return cxn ? [cxn] : undefined;
    }
    case 'graphicFrame':
      return parseTable(el, ctx);
    case 'grpSp':
      // Handled at the parseSpTree level (transform composition).
      return undefined;
    default:
      return undefined;
  }
}

function pptxIdOf(el: Element): number | undefined {
  // `<p:nvSpPr><p:cNvPr id="N">` / `<p:nvPicPr><p:cNvPr id>` / etc.
  // Walk the `nv*Pr` container to find the `cNvPr`.
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    if (!c.localName.startsWith('nv')) continue;
    const cNvPr = child(c, 'cNvPr');
    if (cNvPr) return attrInt(cNvPr, 'id');
  }
  return undefined;
}

function withId(elem: SlideElement, ctx: SlideParseContext, sourceEl: Element): SlideElement {
  const pid = pptxIdOf(sourceEl);
  if (pid != null) {
    const mapped = ctx.idMap.get(pid);
    if (mapped) return { ...elem, id: mapped };
  }
  return elem;
}

function parseSp(sp: Element, ctx: SlideParseContext): SlideElement[] {
  const nvSpPr = child(sp, 'nvSpPr');
  const cNvSpPr = nvSpPr ? child(nvSpPr, 'cNvSpPr') : undefined;
  const isTextBox = cNvSpPr ? attr(cNvSpPr, 'txBox') === '1' : false;

  const spPr = child(sp, 'spPr');
  const xfrm = spPr ? child(spPr, 'xfrm') : undefined;
  const frame = parseXfrm(xfrm, ctx.scale);

  const txBody = child(sp, 'txBody');
  const hasText = !!txBody && hasVisibleText(txBody);
  const elementId = idForSp(sp, ctx);
  const placeholderInfo = readPlaceholderInfo(nvSpPr);
  const placeholderRef = placeholderInfo?.ref;
  const layoutSizeKey = placeholderInfo?.ooxmlKey;

  // Effects — only `outerShdw` is reported; for v1 we drop it.
  const effectLst = spPr ? child(spPr, 'effectLst') : undefined;
  if (effectLst && child(effectLst, 'outerShdw')) {
    ctx.report.shadowsDropped += 1;
  }

  // Pure text box — `txBox=1` shapes have no fill/stroke and exist only
  // as a host for `<p:txBody>`.
  if (isTextBox && txBody) {
    return [buildTextElement(elementId, frame, txBody, ctx, placeholderRef, layoutSizeKey)];
  }

  // Shape with `prstGeom` — emit the shape, then layer a coincident
  // TextElement on top when the shape also carries visible text (the
  // "labelled rect / callout" pattern, ubiquitous in PowerPoint).
  const prstGeom = spPr ? child(spPr, 'prstGeom') : undefined;
  if (prstGeom) {
    const shape = buildShapeElement(elementId, frame, sp, prstGeom, ctx);
    if (!hasText) return [shape];
    const text = buildTextElement(
      generateId(),
      frame,
      txBody!,
      ctx,
      placeholderRef,
      layoutSizeKey,
    );
    return [shape, text];
  }

  // No prstGeom but has text — treat as plain text box.
  if (txBody) {
    return [buildTextElement(elementId, frame, txBody, ctx, placeholderRef, layoutSizeKey)];
  }

  return [];
}

/**
 * Returns true when `<p:txBody>` contains at least one non-empty
 * `<a:t>`. PowerPoint emits empty `<a:p><a:endParaRPr/></a:p>` on every
 * shape regardless of whether the user typed anything, and we don't
 * want to layer a blank text element on top of every plain rectangle.
 */
function hasVisibleText(txBody: Element): boolean {
  const ts = txBody.getElementsByTagName('*');
  for (let i = 0; i < ts.length; i++) {
    const el = ts[i];
    if (el.localName !== 't') continue;
    if ((el.textContent ?? '').length > 0) return true;
  }
  return false;
}

/**
 * OOXML `<p:ph type>` → our `PlaceholderType`. Tokens we don't model
 * (`ftr`, `sldNum`, `hdr`, `dt`, `pic`, `chart`, `media`, ...) return
 * `undefined`, leaving the element with no `placeholderRef`.
 */
const OOXML_PH_TO_TYPE: Record<string, PlaceholderType> = {
  title: 'title',
  ctrTitle: 'title',
  subTitle: 'subtitle',
  body: 'body',
};

/**
 * Heuristic default font sizes by placeholder role, in points. OOXML
 * lets the master/layout placeholder style chain set these per-deck —
 * faithful inheritance is v1.5 work. Until then, these defaults match
 * Google Slides' built-in template sizes for the common roles so title
 * runs don't render at the docs renderer's 11 pt fallback.
 */
const PLACEHOLDER_DEFAULT_FONT_SIZE: Record<PlaceholderType, number> = {
  title: 36,
  subtitle: 24,
  body: 18,
  caption: 14,
  'big-number': 96,
};

function readPlaceholderInfo(
  nvSpPr: Element | undefined,
): { ref: PlaceholderRef | undefined; ooxmlKey: string } | undefined {
  if (!nvSpPr) return undefined;
  const nvPr = child(nvSpPr, 'nvPr');
  if (!nvPr) return undefined;
  const ph = child(nvPr, 'ph');
  if (!ph) return undefined;
  const rawType = attr(ph, 'type') ?? 'body';
  const idxStr = attr(ph, 'idx') ?? '0';
  const ooxmlKey = `${rawType}:${idxStr}`;
  const type = OOXML_PH_TO_TYPE[rawType];
  let ref: PlaceholderRef | undefined;
  if (type) {
    const index = Number(idxStr);
    ref = { type, index: Number.isFinite(index) ? index : 0 };
  }
  return { ref, ooxmlKey };
}

function idForSp(sp: Element, ctx: SlideParseContext): string {
  const pid = pptxIdOf(sp);
  if (pid != null) {
    const existing = ctx.idMap.get(pid);
    if (existing) return existing;
  }
  return generateId();
}

function buildTextElement(
  id: string,
  frame: SlideElement['frame'],
  txBody: Element,
  ctx: SlideParseContext,
  placeholderRef: PlaceholderRef | undefined,
  layoutSizeKey: string | undefined,
): TextElement {
  // Inheritance order: layout placeholder default (parsed from the
  // imported deck) → hardcoded per-type fallback for placeholders we
  // recognise → leave undefined (docs renderer default).
  const layoutSize = layoutSizeKey ? ctx.placeholderSizes.get(layoutSizeKey) : undefined;
  const fallbackSize = placeholderRef
    ? PLACEHOLDER_DEFAULT_FONT_SIZE[placeholderRef.type]
    : undefined;
  const defaultFontSize = layoutSize ?? fallbackSize;
  return {
    id,
    type: 'text',
    frame,
    ...(placeholderRef ? { placeholderRef } : {}),
    data: {
      blocks: parseTextBody(txBody, {
        rels: ctx.rels,
        report: ctx.report,
        defaultFontSize,
        clrMap: ctx.clrMap,
      }),
    },
  };
}

function buildShapeElement(
  id: string,
  frame: SlideElement['frame'],
  sp: Element,
  prstGeom: Element,
  ctx: SlideParseContext,
): ShapeElement {
  const prst = attr(prstGeom, 'prst') ?? 'rect';
  let kind = prstToShapeKind(prst) ?? 'rect';
  if (kind === 'rect' && prst !== 'rect') ctx.report.unknownShapes += 1;

  const adjustments = parseAdjustments(prstGeom);

  const spPr = child(sp, 'spPr');
  const fill = parseShapeFill(spPr, ctx);
  const stroke = parseShapeStroke(spPr, ctx);

  return {
    id,
    type: 'shape',
    frame,
    data: {
      kind,
      ...(adjustments ? { adjustments } : {}),
      ...(fill ? { fill } : {}),
      ...(stroke ? { stroke } : {}),
    },
  };
}

function parseAdjustments(prstGeom: Element): number[] | undefined {
  const avLst = child(prstGeom, 'avLst');
  if (!avLst) return undefined;
  const gds = children(avLst, 'gd');
  if (gds.length === 0) return undefined;
  const out: number[] = [];
  for (const gd of gds) {
    const fmla = attr(gd, 'fmla') ?? '';
    // PPTX adjustment formulas are `val NNN` for direct values; we
    // surface NNN and let the path builder interpret it.
    const m = /^val\s+(-?\d+(?:\.\d+)?)/.exec(fmla);
    if (m) out.push(Number(m[1]));
  }
  return out.length ? out : undefined;
}

function parseShapeFill(
  spPr: Element | undefined,
  ctx: SlideParseContext,
): ShapeElement['data']['fill'] {
  if (!spPr) return undefined;
  const solid = child(spPr, 'solidFill');
  if (solid) return parseColorFromContainer(solid, ctx.clrMap);
  // gradient, pattern, blip-fill on shape — out of v1 scope.
  return undefined;
}

function parseShapeStroke(
  spPr: Element | undefined,
  ctx: SlideParseContext,
): ShapeStroke | undefined {
  if (!spPr) return undefined;
  const ln = child(spPr, 'ln');
  if (!ln) return undefined;
  // `<a:ln w>` is in EMU. Scale with the deck rather than a fixed
  // 96 dpi so strokes stay proportional to scaled frame coordinates
  // for both standard 16:9 (10″×5.625″) and widescreen decks.
  const w = attrInt(ln, 'w');
  const width = w != null ? emuToStrokePx(w, ctx.scale) : 1;
  const solid = child(ln, 'solidFill');
  const color = solid ? parseColorFromContainer(solid, ctx.clrMap) : undefined;
  if (!color) return undefined;
  return { color, width };
}

function parseCxnSp(cxn: Element, ctx: SlideParseContext): ConnectorElement | undefined {
  const elementId = idForSp(cxn, ctx);
  const spPr = child(cxn, 'spPr');
  const xfrm = spPr ? child(spPr, 'xfrm') : undefined;
  const frame = parseXfrm(xfrm, ctx.scale);
  const flipH = xfrm ? attr(xfrm, 'flipH') === '1' : false;
  const flipV = xfrm ? attr(xfrm, 'flipV') === '1' : false;

  const prstGeom = spPr ? child(spPr, 'prstGeom') : undefined;
  const prst = prstGeom ? attr(prstGeom, 'prst') ?? '' : '';
  const routing: ConnectorRouting = prst.startsWith('curved')
    ? 'curved'
    : prst.startsWith('bent')
      ? 'elbow'
      : 'straight';

  const nvCxnSpPr = child(cxn, 'nvCxnSpPr');
  const cNvCxnSpPr = nvCxnSpPr ? child(nvCxnSpPr, 'cNvCxnSpPr') : undefined;
  const stCxn = cNvCxnSpPr ? child(cNvCxnSpPr, 'stCxn') : undefined;
  const endCxn = cNvCxnSpPr ? child(cNvCxnSpPr, 'endCxn') : undefined;

  const start = resolveEndpoint(stCxn, frame, 'start', ctx, flipH, flipV);
  const end = resolveEndpoint(endCxn, frame, 'end', ctx, flipH, flipV);

  const ln = spPr ? child(spPr, 'ln') : undefined;
  const stroke = parseShapeStroke(spPr, ctx);
  const arrowheads = ln
    ? {
        start: parseArrowhead(child(ln, 'headEnd')),
        end: parseArrowhead(child(ln, 'tailEnd')),
      }
    : {};

  return {
    id: elementId,
    type: 'connector',
    frame,
    routing,
    start,
    end,
    arrowheads,
    ...(stroke ? { stroke } : {}),
  };
}

/**
 * Translate an OOXML `cxnLst` index to a Waffle `FOUR_CARDINAL` index.
 *
 * Correct for the T,L,B,R family (`rect`, `roundRect`, the various
 * `*Rect` variants, `plaque`, `bevel`, `flowChartTerminator`, …), whose
 * OOXML order is `T(0), L(1), B(2), R(3)`. Waffle's `FOUR_CARDINAL` is
 * `N(0), E(1), S(2), W(3)` — i.e. `T, R, B, L` — so indices 1 and 3
 * swap; 0 and 2 are unchanged.
 *
 * Other preset shapes (`ellipse`, `triangle`, arrows, callouts, …)
 * declare their own `cxnLst` ordering and length. Today this is
 * harmless because `getConnectionSites()` always returns
 * `FOUR_CARDINAL` regardless of shape kind, so non-T,L,B,R targets
 * resolve to a 4-cardinal site either way. When slides-connectors PR2
 * lands per-`ShapeKind` overrides, this helper must grow into a
 * per-shape `cxnLst → FOUR_CARDINAL` (or per-shape sites) table; until
 * then, out-of-range indices pass through unchanged and fall back to
 * `sites[0]` (N) at render time (`connector-frame.ts`).
 */
const OOXML_TO_WAFFLE_RECT_SITE_INDEX: readonly number[] = [0, 3, 2, 1];

function ooxmlToWaffleSiteIndex(idx: number): number {
  return OOXML_TO_WAFFLE_RECT_SITE_INDEX[idx] ?? idx;
}

function resolveEndpoint(
  cxn: Element | undefined,
  frame: SlideElement['frame'],
  which: 'start' | 'end',
  ctx: SlideParseContext,
  flipH: boolean,
  flipV: boolean,
): Endpoint {
  if (cxn) {
    const idAttr = attrInt(cxn, 'id');
    const idxAttr = attrInt(cxn, 'idx');
    if (idAttr != null) {
      const mapped = ctx.idMap.get(idAttr);
      if (mapped) {
        return {
          kind: 'attached',
          elementId: mapped,
          siteIndex: ooxmlToWaffleSiteIndex(idxAttr ?? 0),
        };
      }
    }
  }
  // Fall back to absolute frame corners. The default `straightConnector1`
  // routes (x,y) → (x+w, y+h). `flipH`/`flipV` swap the active corner
  // on each axis independently — e.g. a `flipH` connector starts at
  // top-right and ends at bottom-left.
  const startHorizontal = (which === 'start') !== flipH;
  const startVertical = (which === 'start') !== flipV;
  const x = startHorizontal ? frame.x : frame.x + frame.w;
  const y = startVertical ? frame.y : frame.y + frame.h;
  return { kind: 'free', x, y };
}

const OOXML_ARROW_TO_KIND: Record<string, ArrowheadKind> = {
  triangle: 'triangle',
  arrow: 'triangle-open',
  stealth: 'triangle',
  diamond: 'diamond',
  oval: 'circle',
};

function parseArrowhead(end: Element | undefined): ArrowheadStyle | undefined {
  if (!end) return undefined;
  const type = attr(end, 'type');
  if (!type || type === 'none') return undefined;
  const kind = OOXML_ARROW_TO_KIND[type];
  if (!kind) return undefined;
  const sizeAttr = attr(end, 'len') ?? attr(end, 'w') ?? 'med';
  const size: ArrowheadStyle['size'] =
    sizeAttr === 'sm' ? 'sm' : sizeAttr === 'lg' ? 'lg' : 'md';
  return { kind, size };
}

// Re-export the shared parser for slide.ts so a one-time test fixture can
// build a sample <p:sld> via parseXml and exercise parseSpTree directly.
export { parseXml, NS };
