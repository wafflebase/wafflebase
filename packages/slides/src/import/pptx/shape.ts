import type {
  Effects,
  Element as SlideElement,
  FreeformPath,
  GroupElement,
  ImageElement,
  PlaceholderRef,
  PlaceholderType,
  ShapeElement,
  ShapeKind,
  ShapeStroke,
  TextBody,
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
import { parseEffects, readAltText } from './effects';
import type { TxStylesMarkers, TxStylesSlot } from './master';
import type { EmuScale } from './geometry';
import { emuToStrokePx, parseXfrm, prstToShapeKind } from './geometry';
import {
  applyGroupTransform,
  applyGroupTransformToPoint,
  composeGroupTransform,
  IDENTITY_TRANSFORM,
  type GroupTransform,
} from './group';
import { parseCustGeomPath } from './freeform';
import { parseBlipFill, parsePic, type ImageParseContext } from './image';
import { ImportReport } from './report';
import { parseTable } from './table';
import {
  parseTextBody,
  detectAutofitMode,
  detectVerticalAnchor,
  detectBodyInset,
} from './text';
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
   * Parallel to `idMap`: the resolved `ShapeKind` for each `<p:sp>`
   * with a `<a:prstGeom>` we recognise. Connector endpoint resolution
   * uses this to pick a shape-specific OOXML `cxnLst → site index`
   * remap (e.g. ellipse uses 8-point CCW-from-top; rect family uses
   * `[T,L,B,R]`). Unknown / non-shape targets fall back to the rect
   * remap, matching the prior behavior. Required so a forgotten
   * initialization at a new call site fails TypeScript loudly rather
   * than silently degrading every ellipse connector to the wrong
   * cardinal site (the exact bug this map was added to fix).
   */
  shapeKindByPptxId: Map<number, ShapeKind>;
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
  /**
   * Master-level `<p:txStyles>` bullet defaults per slot × level.
   * `buildTextElement` looks up the slot from the host shape's
   * `<p:ph type>` and forwards the level→marker map to the text parser
   * so paragraphs can inherit `buFont`/`buSzPts`/`buClr` that aren't
   * inlined on the slide itself. Optional so existing test harnesses
   * that exercise `parseSpTree` directly can omit it without rewriting
   * every fixture; missing entry is equivalent to "no master defaults".
   */
  txStylesMarkers?: TxStylesMarkers;
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
  preassignIds(spTree, ctx.idMap, ctx.shapeKindByPptxId);

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
  // No group-level effects import: the renderer paints drop shadow /
  // reflection on single-silhouette leaves only (shape / image / text),
  // and the Format panel doesn't expose group effects — importing
  // `<p:grpSpPr><a:effectLst>` would be unrenderable, uneditable dead data.
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

function preassignIds(
  parent: Element,
  idMap: Map<number, string>,
  shapeKindMap: Map<number, ShapeKind>,
): void {
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
        if (id != null && el.localName === 'sp') {
          const spPr = child(el, 'spPr');
          const prstGeom = spPr ? child(spPr, 'prstGeom') : undefined;
          const prst = prstGeom ? attr(prstGeom, 'prst') : undefined;
          const kind = prst ? prstToShapeKind(prst) : undefined;
          if (kind) shapeKindMap.set(id, kind);
        }
        break;
      }
      case 'grpSp':
        preassignIds(el, idMap, shapeKindMap);
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
      const sps = await parseSp(el, ctx);
      if (sps.length === 0) return undefined;
      const spPr = child(el, 'spPr');
      const effects = parseEffects(spPr, ctx.scale, ctx.clrMap);
      const alt = readAltText(el);
      if (effects || alt) attachEffectsAndAlt(sps[0], effects, alt);
      return sps;
    }
    case 'pic': {
      const picCtx: ImageParseContext = {
        archive: ctx.archive,
        slidePartPath: ctx.slidePartPath,
        rels: ctx.rels,
        uploadImage: ctx.uploadImage,
        scale: ctx.scale,
        report: ctx.report,
        clrMap: ctx.clrMap,
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

/**
 * Attach the host `<p:sp>`'s parsed effects / alt text to the element it
 * produced. Applied to the first emitted element only: a `<p:sp>` is one
 * element in every case but blip-fill-with-text, where the picture (first)
 * is the silhouette that should carry the shadow / reflection / alt and the
 * caption text overlay must NOT re-cast a duplicate effect. Connectors (no
 * effects/alt in the model) and groups (no `alt`) are excluded by type.
 */
function attachEffectsAndAlt(
  el: SlideElement,
  effects: Effects | undefined,
  alt: string | undefined,
): void {
  if (effects && el.type !== 'connector') {
    (el.data as { effects?: Effects }).effects = effects;
  }
  if (alt && el.type !== 'connector' && el.type !== 'group') {
    (el.data as { alt?: string }).alt = alt;
  }
}

function withId(elem: SlideElement, ctx: SlideParseContext, sourceEl: Element): SlideElement {
  const pid = pptxIdOf(sourceEl);
  if (pid != null) {
    const mapped = ctx.idMap.get(pid);
    if (mapped) return { ...elem, id: mapped };
  }
  return elem;
}

async function parseSp(sp: Element, ctx: SlideParseContext): Promise<SlideElement[]> {
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

  // Drop shadow / reflection (effects) and alt text are attached to every
  // element this `<p:sp>` emits by `parseChild`, which has the source
  // `<p:sp>` node and the slide clrMap in scope.

  // Text box (`txBox=1`) — a `<p:txBody>` host that usually has no
  // fill/stroke. But Google Slides exports labelled callout boxes as
  // `txBox=1` shapes carrying an explicit `<a:solidFill>` background and
  // `<a:ln>` border (e.g. the "Network Interruption" label); preserve
  // those so the box stays opaque instead of letting underlying shapes
  // (a connector line, here) show through it. The renderer paints a text
  // element's `data.fill`/`data.stroke` just like a shape's.
  if (isTextBox && txBody) {
    const fill = parseShapeFill(spPr, ctx);
    const stroke = parseShapeStroke(spPr, ctx);
    return [
      buildTextElement(elementId, frame, txBody, ctx, placeholderRef, layoutSizeKey, fill, stroke),
    ];
  }

  // Shape with `<a:blipFill>` — treat as picture, regardless of geometry.
  // PowerPoint exports routinely build full-bleed visuals (e.g. doodle
  // template backgrounds) as `<p:sp>` wrapping `<a:custGeom>` (or
  // `<a:prstGeom prst="rect">`) + `<a:blipFill>`, which is semantically
  // equivalent to a `<p:pic>`. Treating it as an `ImageElement` preserves
  // the visible result; the clip path of a genuinely non-rect freeform
  // is lost, which we accept for v1 (covers >99% of real-world decks).
  const blipFill = spPr ? child(spPr, 'blipFill') : undefined;
  if (blipFill) {
    const image = await buildImageFromBlip(elementId, frame, blipFill, ctx);
    if (image) {
      if (!hasText) return [image];
      const text = buildTextElement(
        generateId(),
        frame,
        txBody!,
        ctx,
        placeholderRef,
        layoutSizeKey,
      );
      return [image, text];
    }
    // Blip upload failed / unresolved — fall through so the shape still
    // contributes whatever geometry / text it has rather than vanishing.
  }

  // Shape with `prstGeom` — emit a single ShapeElement. If the OOXML
  // `<p:sp>` carries a non-empty `<p:txBody>`, fold it into
  // `data.text` so the shape owns its inline text directly (matches
  // PowerPoint / Google Slides where every autoshape is a text
  // container). The renderer paints `data.text` on top of the shape's
  // fill/stroke; the editor's double-click / type-to-edit paths route
  // through `withShapeText`. Pre-shape-text-body imports used a paired
  // (`ShapeElement`, `TextElement`) layered form; the new form is one
  // element. Placeholder-bound shapes still propagate `placeholderRef`
  // — it lives on the element itself, not on the text body, so the
  // layout-slot identity transfers naturally to the shape.
  const prstGeom = spPr ? child(spPr, 'prstGeom') : undefined;
  if (prstGeom) {
    const shape = buildShapeElement(elementId, frame, sp, prstGeom, ctx);
    if (hasText) {
      shape.data.text = buildTextBody(txBody!, ctx, placeholderRef, layoutSizeKey);
    }
    if (placeholderRef) shape.placeholderRef = placeholderRef;
    return [shape];
  }

  // Shape with `<a:custGeom>` — a freeform/path shape. PowerPoint exports
  // decorative blobs, doodles, and silhouettes as custom geometry; without
  // a branch here they match nothing below and are silently dropped. Emit
  // a `freeform` ShapeElement carrying the normalized vector path so the
  // fill/stroke (and any inline text) render. (custGeom that also has a
  // `<a:blipFill>` is handled by the image branch above.)
  const custGeom = spPr ? child(spPr, 'custGeom') : undefined;
  if (custGeom) {
    // Only emit when there's actual geometry. A custGeom with an empty /
    // unparseable `<a:pathLst>` has nothing to render; emitting a path-less
    // freeform would resurrect the "phantom shape" the blipFill-fallback
    // path deliberately drops (see shape-blipfill.test.ts). Shapes with a
    // real path are kept — that is the silent-loss bug this branch fixes.
    const path = parseCustGeomPath(custGeom);
    if (path) {
      const shape = buildFreeformElement(elementId, frame, sp, path, ctx);
      if (hasText) {
        shape.data.text = buildTextBody(txBody!, ctx, placeholderRef, layoutSizeKey);
      }
      if (placeholderRef) shape.placeholderRef = placeholderRef;
      return [shape];
    }
  }

  // No prstGeom but has text — treat as plain text box.
  if (txBody) {
    return [buildTextElement(elementId, frame, txBody, ctx, placeholderRef, layoutSizeKey)];
  }

  return [];
}

async function buildImageFromBlip(
  id: string,
  frame: SlideElement['frame'],
  blipFill: Element,
  ctx: SlideParseContext,
): Promise<ImageElement | undefined> {
  const imageCtx: ImageParseContext = {
    archive: ctx.archive,
    slidePartPath: ctx.slidePartPath,
    rels: ctx.rels,
    uploadImage: ctx.uploadImage,
    scale: ctx.scale,
    report: ctx.report,
    clrMap: ctx.clrMap,
  };
  const blip = await parseBlipFill(blipFill, imageCtx);
  if (!blip) return undefined;
  return { id, type: 'image', frame, data: blip };
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
  fill?: TextElement['data']['fill'],
  stroke?: TextElement['data']['stroke'],
): TextElement {
  return {
    id,
    type: 'text',
    frame,
    ...(placeholderRef ? { placeholderRef } : {}),
    data: {
      ...buildTextBody(txBody, ctx, placeholderRef, layoutSizeKey),
      ...(fill ? { fill } : {}),
      ...(stroke ? { stroke } : {}),
    },
  };
}

/**
 * Parse a `<p:txBody>` (the OOXML element that PPTX uses for both
 * stand-alone text boxes and the text inside shapes) into a `TextBody`.
 * Shared between `buildTextElement` (text-only `<p:sp>`) and the
 * prstGeom branch of `parseSp` (shape `<p:sp>` whose `<p:txBody>` now
 * folds into `ShapeElement.data.text`).
 */
function buildTextBody(
  txBody: Element,
  ctx: SlideParseContext,
  placeholderRef: PlaceholderRef | undefined,
  layoutSizeKey: string | undefined,
): TextBody {
  // Inheritance order: layout placeholder default (parsed from the
  // imported deck) → hardcoded per-type fallback for placeholders we
  // recognise → leave undefined (docs renderer default).
  const layoutSize = layoutSizeKey ? ctx.placeholderSizes.get(layoutSizeKey) : undefined;
  const fallbackSize = placeholderRef
    ? PLACEHOLDER_DEFAULT_FONT_SIZE[placeholderRef.type]
    : undefined;
  const defaultFontSize = layoutSize ?? fallbackSize;
  const markerDefaults = ctx.txStylesMarkers?.get(
    placeholderTypeToTxStylesSlot(placeholderRef?.type),
  );
  const verticalAnchor = detectVerticalAnchor(txBody);
  const inset = detectBodyInset(txBody, ctx.scale);
  return {
    autofit: detectAutofitMode(txBody),
    ...(verticalAnchor !== undefined ? { verticalAnchor } : {}),
    ...(inset !== undefined ? { inset } : {}),
    blocks: parseTextBody(txBody, {
      rels: ctx.rels,
      report: ctx.report,
      defaultFontSize,
      clrMap: ctx.clrMap,
      markerDefaults,
    }),
  };
}

/**
 * Map a Waffle `PlaceholderType` to the OOXML `<p:txStyles>` slot whose
 * level table holds its bullet defaults. PowerPoint uses three buckets
 * — title-style for titles, body-style for the outline/body group, and
 * other-style as the catch-all — so non-placeholder text boxes inherit
 * via the body bucket (matches PowerPoint's "default text" behaviour).
 *
 * Note: `OOXML_PH_TO_TYPE` (above) only emits `title` / `subtitle` /
 * `body` from PPTX import today. The `big-number` / `caption` branch is
 * Waffle-only placeholder kinds the importer never produces — kept here
 * so future placeholder additions route deterministically rather than
 * silently falling through to the body bucket.
 */
function placeholderTypeToTxStylesSlot(
  type: PlaceholderType | undefined,
): TxStylesSlot {
  if (type === 'title') return 'title';
  if (type === 'big-number' || type === 'caption') return 'other';
  // body, subtitle, and plain text boxes (no placeholder) → body slot.
  return 'body';
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

function buildFreeformElement(
  id: string,
  frame: SlideElement['frame'],
  sp: Element,
  path: FreeformPath,
  ctx: SlideParseContext,
): ShapeElement {
  const spPr = child(sp, 'spPr');
  const fill = parseShapeFill(spPr, ctx);
  const stroke = parseShapeStroke(spPr, ctx);

  // Line-end arrowheads live on `<a:ln>` (`<a:headEnd>`/`<a:tailEnd>`),
  // exactly like connectors. PowerPoint exports arrowed curves as freeform
  // `<p:sp>` custGeom, so parse them here rather than dropping the tips.
  // Only meaningful on a *stroked*, *single open subpath*:
  //   - no stroke ⇒ no visible line to decorate;
  //   - a closed outline (`<a:close/>` ⇒ trailing 'Z') has no open ends;
  //   - a compound path (>1 `M` subpath) has an ambiguous "the start"/"the
  //     end", so we drop rather than anchor a tip to the wrong subpath.
  // Gating here keeps import, render, and export symmetric and matches how
  // arrowed freeforms are actually authored (a single open path).
  const cmds = path.commands;
  const subpaths = cmds.reduce((n, c) => (c.c === 'M' ? n + 1 : n), 0);
  const open = subpaths === 1 && cmds.length > 0 && cmds[cmds.length - 1].c !== 'Z';
  const ln = stroke && open && spPr ? child(spPr, 'ln') : undefined;
  const start = ln ? parseArrowhead(child(ln, 'headEnd')) : undefined;
  const end = ln ? parseArrowhead(child(ln, 'tailEnd')) : undefined;
  const arrowheads = start || end ? { ...(start ? { start } : {}), ...(end ? { end } : {}) } : undefined;

  return {
    id,
    type: 'shape',
    frame,
    data: {
      kind: 'freeform',
      path,
      ...(fill ? { fill } : {}),
      ...(stroke ? { stroke } : {}),
      ...(arrowheads ? { arrowheads } : {}),
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
  // gradient and pattern fills on shapes are out of v1 scope. Blip
  // fills *are* handled — see the `<a:blipFill>` branch in `parseSp`,
  // which short-circuits to an `ImageElement` before we get here.
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
 * Translate an OOXML `cxnLst` index to a Waffle site index, picking the
 * remap based on the target shape's `ShapeKind`.
 *
 * - **Rect family** (`rect`, `roundRect`, the various `*Rect` variants,
 *   `plaque`, `bevel`, `flowChartTerminator`, …): OOXML `cxnLst` order
 *   is `T(0), L(1), B(2), R(3)`; Waffle `FOUR_CARDINAL` is
 *   `N(0), E(1), S(2), W(3)` — i.e. `T, R, B, L` — so indices 1 and 3
 *   swap; 0 and 2 are unchanged. This is the default for any target
 *   without a more specific remap registered below.
 * - **Ellipse / oval**: PPTX `cxnLst` is 8 points CCW from top
 *   (`N, NW, W, SW, S, SE, E, NE`). The matching `ELLIPSE_SITES`
 *   override in `connection-sites/overrides.ts` stores entries in the
 *   same order, so the OOXML idx is the Waffle site index verbatim
 *   (identity remap).
 *
 * Other multi-vertex presets (`triangle` / `rtTriangle`, n-gons,
 * arrows, callouts) still fall through to the rect-family remap.
 * That's a noted incomplete spot, deferred to a follow-up — see the
 * top-of-file comment in `connection-sites/overrides.ts`. Out-of-range
 * indices pass through unchanged and the renderer's
 * `sites[idx] ?? sites[0]` fallback (`connector-frame.ts`) lands on N.
 */
const OOXML_TO_WAFFLE_RECT_SITE_INDEX: readonly number[] = [0, 3, 2, 1];

function ooxmlToWaffleSiteIndex(idx: number, targetKind?: ShapeKind): number {
  if (targetKind === 'ellipse') return idx;
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
        const targetKind = ctx.shapeKindByPptxId.get(idAttr);
        return {
          kind: 'attached',
          elementId: mapped,
          siteIndex: ooxmlToWaffleSiteIndex(idxAttr ?? 0, targetKind),
        };
      }
    }
  }
  // Fall back to absolute frame corners. The default `straightConnector1`
  // routes the box top-left → bottom-right; `start` is the top-left
  // corner, `end` the bottom-right. `flipH`/`flipV`/`rot` then transform
  // those corners about the frame centre. Connectors paint in world
  // coordinates with no per-element frame transform (see
  // `connector-renderer.ts`), so the flip AND rotation must be baked into
  // the resolved endpoints here. We mirror first, then rotate, matching
  // OOXML `<a:xfrm>` and `element-renderer`'s rotate-then-scale order
  // (a point flows flip → rotate → translate). Without the rotation a
  // connector with both `flipH` and `rot=180°` — where the two cancel on
  // a horizontal line — resolves its endpoints (and thus its arrowhead)
  // to the wrong side.
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  // Local corner relative to centre before any transform.
  let lx = (which === 'start' ? -frame.w : frame.w) / 2;
  let ly = (which === 'start' ? -frame.h : frame.h) / 2;
  if (flipH) lx = -lx;
  if (flipV) ly = -ly;
  const rot = frame.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { kind: 'free', x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
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
