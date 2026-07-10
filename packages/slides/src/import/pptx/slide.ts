import type { Block, BlockStyle } from '@wafflebase/docs';
import type { Frame } from '../../model/element';
import type { Background, Slide } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import { clone } from '../../model/clone';
import { parseColorFromContainer, type ClrMap } from './color';
import { type EmuScale } from './geometry';
import { parseBlipFill, toBackgroundImage, type ImageParseContext } from './image';
import type { TxStylesAlignments, TxStylesMarkers } from './master';
import { parseRels, resolveRelsTarget, type PptxRel } from './rels';
import { ImportReport } from './report';
import { parseSpTree, type SlideParseContext } from './shape';
import { parseTextBody } from './text';
import { parseTiming } from './timing';
import { parseTransition } from './transition-map';
import type { PptxArchive } from './unzip';
import type { UploadImage } from './index';
import { attr, child, descendant, parseXml } from './xml';

/** Per-layout resolution data: built-in id + placeholder default sizes. */
export interface LayoutResolution {
  builtInId: string;
  /** Map of `"{ooxmlType}:{idx}"` → default fontSize in points. */
  placeholderSizes: Map<string, number>;
  /**
   * Map of `"{ooxmlType}:{idx}"` → default paragraph alignment from the
   * layout placeholder's `<a:lstStyle><a:lvl1pPr algn>`. A slide paragraph
   * with no own `algn` inherits this. Optional so test harnesses can omit it.
   */
  placeholderAlignments?: Map<string, BlockStyle['alignment']>;
  /**
   * Map of `"{ooxmlType}:{idx}"` → layout placeholder frame (px). A slide
   * placeholder with no own `<a:xfrm>` inherits this (slide → layout
   * geometry). Optional so test harnesses can omit it.
   */
  placeholderFrames?: Map<string, Frame>;
  /**
   * Layout-level `<p:bg>` background (image / solid), when the layout defines
   * a real one. A slide with no `<p:bg>` of its own bakes this at parse time
   * (PPTX inheritance slide → layout). Keyed per layout part path so the
   * collapse of many OOXML layouts onto one built-in id doesn't cross wires.
   */
  background?: Background;
}

/** Maps from imported OOXML layout part path → resolution data. */
export type LayoutPathToInfo = Map<string, LayoutResolution>;

export interface ParseSlideOptions {
  archive: PptxArchive;
  /** e.g. `'ppt/slides/slide1.xml'` */
  partPath: string;
  /** Pre-built mapping for resolving each slide's layout rel to a built-in layout id. */
  layoutMap: LayoutPathToInfo;
  uploadImage?: UploadImage;
  scale: EmuScale;
  report: ImportReport;
  /** Master-level color map; identity for decks without `<p:clrMap>`. */
  clrMap: ClrMap;
  /**
   * Master-level `<p:txStyles>` defaults for bullet markers per slot × level.
   * Optional so test harnesses that exercise `parseSlide` directly can
   * skip wiring up the txStyles map; missing entry is equivalent to "no
   * master defaults" and the importer falls back to the paragraph's own
   * `<a:buFont>`/`<a:buSzPts>`/`<a:buClr>` (which can also be absent).
   */
  txStylesMarkers?: TxStylesMarkers;
  /**
   * Master-level `<p:txStyles>` default alignment per slot — the deeper
   * fallback when a slide's layout placeholder sets no `algn`. Optional,
   * mirroring {@link txStylesMarkers}.
   */
  txStylesAlignments?: TxStylesAlignments;
}

export async function parseSlide(opts: ParseSlideOptions): Promise<Slide | undefined> {
  const xml = await opts.archive.readText(opts.partPath);
  if (!xml) return undefined;
  const doc = parseXml(xml);
  const slideEl = descendant(doc, 'sld');
  if (!slideEl) return undefined;

  const relsPath = relsSiblingFor(opts.partPath);
  const relsXml = await opts.archive.readText(relsPath);
  const rels = relsXml ? parseRels(relsXml) : new Map<string, PptxRel>();

  // Resolve the layout — slide picks its layout via `slideLayout` rel.
  const layoutInfo = pickLayoutInfo(rels, opts.partPath, opts.layoutMap);
  const layoutId = layoutInfo?.builtInId ?? 'title-body';
  const placeholderSizes = layoutInfo?.placeholderSizes ?? new Map<string, number>();

  // Background: the slide's own `<p:cSld><p:bg>` wins; otherwise PPTX
  // inheritance falls to the layout (slide → layout → master). We bake the
  // layout's background here — keyed on the slide's exact layout part path —
  // so a slide with no `<p:bg>` still renders its layout's gradient / image
  // (the collapsed built-in id can't carry it unambiguously).
  const cSld = child(slideEl, 'cSld');
  const bgEl = cSld ? child(cSld, 'bg') : undefined;
  const imageCtx: ImageParseContext = {
    archive: opts.archive,
    slidePartPath: opts.partPath,
    rels,
    uploadImage: opts.uploadImage,
    scale: opts.scale,
    report: opts.report,
  };
  const background = bgEl
    ? await parseSlideBackground(bgEl, opts.clrMap, imageCtx)
    : layoutInfo?.background
      ? clone(layoutInfo.background)
      : clone(DEFAULT_BACKGROUND);

  const spTree = cSld ? child(cSld, 'spTree') : undefined;
  const ctx: SlideParseContext = {
    archive: opts.archive,
    slidePartPath: opts.partPath,
    rels,
    uploadImage: opts.uploadImage,
    scale: opts.scale,
    report: opts.report,
    idMap: new Map(),
    shapeKindByPptxId: new Map(),
    placeholderSizes,
    placeholderAlignments: layoutInfo?.placeholderAlignments ?? new Map(),
    placeholderFrames: layoutInfo?.placeholderFrames ?? new Map(),
    clrMap: opts.clrMap,
    txStylesMarkers: opts.txStylesMarkers,
    txStylesAlignments: opts.txStylesAlignments,
  };
  const elements = spTree ? await parseSpTree(spTree, ctx) : [];

  const notes = await parseNotes(opts.archive, opts.partPath, rels, opts.report);

  const transition = parseTransition(child(slideEl, 'transition'), opts.report);

  const spidToElementId = new Map<string, string>();
  for (const [pptxId, elId] of ctx.idMap) spidToElementId.set(String(pptxId), elId);
  const animations = parseTiming(child(slideEl, 'timing'), { spidToElementId, report: opts.report });

  return {
    id: opts.partPath, // stable id keyed on source part path
    layoutId,
    background,
    elements,
    notes,
    ...(transition !== undefined && { transition }),
    ...(animations.length > 0 && { animations }),
  };
}

function pickLayoutInfo(
  rels: Map<string, PptxRel>,
  slidePart: string,
  layoutMap: LayoutPathToInfo,
): LayoutResolution | undefined {
  for (const rel of rels.values()) {
    if (rel.type !== 'slideLayout') continue;
    const path = resolveRelsTarget(slidePart, rel.target);
    const mapped = layoutMap.get(path);
    if (mapped) return mapped;
  }
  return undefined;
}

/**
 * Parse a `<p:bg>` element (from a slide, layout, or any `<p:cSld>`) into a
 * {@link Background}. Handles `<p:bgPr>` with `blipFill` (image) or
 * `solidFill` (color); `<p:bgRef>` style-matrix indices are unhandled and
 * fall through to {@link DEFAULT_BACKGROUND}. Exported so the layout parser
 * reuses the exact same semantics rather than keeping a third copy.
 */
export async function parseSlideBackground(
  bgEl: Element,
  clrMap: ClrMap,
  imageCtx: ImageParseContext,
): Promise<Background> {
  const bgPr = child(bgEl, 'bgPr');
  if (bgPr) {
    // blipFill (image background) — populate `image` alongside the
    // theme-role fill so transparent regions of the image still show
    // a sensible color underneath, and so an upload failure doesn't
    // leave us with a missing background entirely.
    const blipFill = child(bgPr, 'blipFill');
    if (blipFill) {
      const blip = await parseBlipFill(blipFill, imageCtx);
      if (blip) {
        return { fill: clone(DEFAULT_BACKGROUND).fill, image: toBackgroundImage(blip) };
      }
      // Upload failed / blip unresolved — fall through so the slide
      // still gets the theme background instead of nothing.
    }
    const solid = child(bgPr, 'solidFill');
    if (solid) {
      const color = parseColorFromContainer(solid, clrMap);
      if (color) return { fill: color };
    }
  }
  return clone(DEFAULT_BACKGROUND);
}

async function parseNotes(
  archive: PptxArchive,
  slidePart: string,
  rels: Map<string, PptxRel>,
  report: ImportReport,
): Promise<Block[]> {
  let notesTarget: string | undefined;
  for (const rel of rels.values()) {
    if (rel.type === 'notesSlide') {
      notesTarget = rel.target;
      break;
    }
  }
  if (!notesTarget) return [];

  const notesPath = resolveRelsTarget(slidePart, notesTarget);
  const notesXml = await archive.readText(notesPath);
  if (!notesXml) return [];

  const notesDoc = parseXml(notesXml);
  // `<p:notes><p:cSld><p:spTree>` holds the notes placeholders. A
  // notes slide typically contains several shapes — slide image,
  // body placeholder, slide number, header/footer/date — and only
  // `<p:ph type="body">` carries the speaker notes content.
  const spTree = descendant(notesDoc, 'spTree');
  if (!spTree) return [];

  // First pass: look for the body placeholder specifically (PowerPoint
  // emits `<p:ph type="body">` for the notes text host).
  let bodyTxBody: Element | undefined;
  let fallbackTxBody: Element | undefined;
  let fallbackLength = 0;
  for (let i = 0; i < spTree.childNodes.length; i++) {
    const n = spTree.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.localName !== 'sp') continue;
    const txBody = child(el, 'txBody');
    if (!txBody) continue;

    const nvSpPr = child(el, 'nvSpPr');
    const nvPr = nvSpPr ? child(nvSpPr, 'nvPr') : undefined;
    const ph = nvPr ? child(nvPr, 'ph') : undefined;
    const phType = ph ? attr(ph, 'type') : undefined;
    if (phType === 'body') {
      bodyTxBody = txBody;
      break;
    }
    // Track the longest non-placeholder txBody as a fallback in case
    // the deck omits the body placeholder type entirely.
    if (!ph || (phType !== 'sldNum' && phType !== 'hdr' && phType !== 'dt')) {
      const len = (txBody.textContent ?? '').length;
      if (len > fallbackLength) {
        fallbackTxBody = txBody;
        fallbackLength = len;
      }
    }
  }

  const chosen = bodyTxBody ?? fallbackTxBody;
  if (!chosen) return [];
  return parseTextBody(chosen, { report });
}

function relsSiblingFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const dir = slash >= 0 ? partPath.slice(0, slash) : '';
  const file = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return (dir ? dir + '/' : '') + '_rels/' + file + '.rels';
}
