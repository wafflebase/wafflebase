import type {
  Element as SlideElement,
  PlaceholderRef,
  PlaceholderType,
  ShapeElement,
  ShapeStroke,
  TextElement,
} from '../../model/element';
import { generateId } from '../../model/element';
import type {
  ArrowheadKind,
  ArrowheadStyle,
  ConnectorElement,
  ConnectorRouting,
  Endpoint,
} from '../../model/connector';
import { parseColorFromContainer } from './color';
import type { EmuScale } from './geometry';
import { parseXfrm, prstToShapeKind } from './geometry';
import {
  applyGroupTransform,
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
}

/**
 * Walk a `<p:spTree>` (or a flattened `<p:grpSp>`) in two passes:
 *   Pass 1: assign element ids to every shape so connectors can resolve
 *           attached endpoints regardless of source order.
 *   Pass 2: actually parse each child, recursing into groups.
 *
 * Groups and tables are deferred to Task 4 — for now they emit nothing
 * and bump no counters (the caller will report on them once the v1
 * fallbacks land).
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

  // Pass 2: parse each child element, applying the cumulative group
  // transform to every element's frame.
  const out: SlideElement[] = [];
  for (let i = 0; i < spTree.childNodes.length; i++) {
    const n = spTree.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;

    if (el.localName === 'grpSp') {
      const childTransform = composeGroupTransform(transform, el, ctx.scale);
      const flattened = await parseSpTree(el, ctx, childTransform);
      out.push(...flattened);
      ctx.report.groupsFlattened += 1;
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
            x: transform.parentOffX + (elem.start.x - transform.childBaseX) * transform.scaleX,
            y: transform.parentOffY + (elem.start.y - transform.childBaseY) * transform.scaleY,
          }
        : elem.start;
    const end =
      elem.end.kind === 'free'
        ? {
            kind: 'free' as const,
            x: transform.parentOffX + (elem.end.x - transform.childBaseX) * transform.scaleX,
            y: transform.parentOffY + (elem.end.y - transform.childBaseY) * transform.scaleY,
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
      const sp = parseSp(el, ctx);
      return sp ? [sp] : undefined;
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

function parseSp(sp: Element, ctx: SlideParseContext): SlideElement | undefined {
  const nvSpPr = child(sp, 'nvSpPr');
  const cNvSpPr = nvSpPr ? child(nvSpPr, 'cNvSpPr') : undefined;
  const isTextBox = cNvSpPr ? attr(cNvSpPr, 'txBox') === '1' : false;

  const spPr = child(sp, 'spPr');
  const xfrm = spPr ? child(spPr, 'xfrm') : undefined;
  const frame = parseXfrm(xfrm, ctx.scale);

  const txBody = child(sp, 'txBody');
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
  // as a host for `<p:txBody>`. Emit a TextElement.
  if (isTextBox && txBody) {
    return buildTextElement(elementId, frame, txBody, ctx, placeholderRef, layoutSizeKey);
  }

  // Shape with a `prstGeom` — emit a ShapeElement; if it also has text,
  // we layer a TextElement on top (caller will append both — but for v1
  // we keep one element per source <p:sp> and prefer the shape).
  const prstGeom = spPr ? child(spPr, 'prstGeom') : undefined;
  if (prstGeom) {
    return buildShapeElement(elementId, frame, sp, prstGeom, ctx);
  }

  // No prstGeom but has text — treat as plain text box.
  if (txBody) {
    return buildTextElement(elementId, frame, txBody, ctx, placeholderRef, layoutSizeKey);
  }

  return undefined;
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
  const fill = parseShapeFill(spPr);
  const stroke = parseShapeStroke(spPr);

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

function parseShapeFill(spPr: Element | undefined): ShapeElement['data']['fill'] {
  if (!spPr) return undefined;
  const solid = child(spPr, 'solidFill');
  if (solid) return parseColorFromContainer(solid);
  // gradient, pattern, blip-fill on shape — out of v1 scope.
  return undefined;
}

function parseShapeStroke(spPr: Element | undefined): ShapeStroke | undefined {
  if (!spPr) return undefined;
  const ln = child(spPr, 'ln');
  if (!ln) return undefined;
  // `<a:ln w>` is in EMU (9525 EMU = 1 px at 96 dpi).
  const w = attrInt(ln, 'w');
  const width = w != null ? Math.max(0, w / 9525) : 1;
  const solid = child(ln, 'solidFill');
  const color = solid ? parseColorFromContainer(solid) : undefined;
  if (!color) return undefined;
  return { color, width };
}

function parseCxnSp(cxn: Element, ctx: SlideParseContext): ConnectorElement | undefined {
  const elementId = idForSp(cxn, ctx);
  const spPr = child(cxn, 'spPr');
  const xfrm = spPr ? child(spPr, 'xfrm') : undefined;
  const frame = parseXfrm(xfrm, ctx.scale);

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

  const start = resolveEndpoint(stCxn, frame, 'start', ctx);
  const end = resolveEndpoint(endCxn, frame, 'end', ctx);

  const ln = spPr ? child(spPr, 'ln') : undefined;
  const stroke = parseShapeStroke(spPr);
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

function resolveEndpoint(
  cxn: Element | undefined,
  frame: SlideElement['frame'],
  which: 'start' | 'end',
  ctx: SlideParseContext,
): Endpoint {
  if (cxn) {
    const idAttr = attrInt(cxn, 'id');
    const idxAttr = attrInt(cxn, 'idx');
    if (idAttr != null) {
      const mapped = ctx.idMap.get(idAttr);
      if (mapped) {
        return { kind: 'attached', elementId: mapped, siteIndex: idxAttr ?? 0 };
      }
    }
  }
  // Fall back to absolute frame corners. `frame` is already in px.
  const x = which === 'start' ? frame.x : frame.x + frame.w;
  const y = which === 'start' ? frame.y : frame.y + frame.h;
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
