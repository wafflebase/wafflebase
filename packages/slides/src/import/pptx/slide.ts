import type { Block } from '@wafflebase/docs';
import type { Background, Slide } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import { clone } from '../../model/clone';
import { parseColorFromContainer, type ClrMap } from './color';
import { type EmuScale } from './geometry';
import { parseBlipFill, toBackgroundImage, type ImageParseContext } from './image';
import type { TxStylesMarkers } from './master';
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

  // Background may be on the slide's `<p:cSld>` (override) or inherited
  // from the master. v1 records an override only when present.
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
    clrMap: opts.clrMap,
    txStylesMarkers: opts.txStylesMarkers,
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

async function parseSlideBackground(
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
