import type { Block } from '@wafflebase/docs';
import type { Background, Slide } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import { parseColorFromContainer } from './color';
import { type EmuScale } from './geometry';
import { parseRels, resolveRelsTarget, type PptxRel } from './rels';
import { ImportReport } from './report';
import { parseSpTree, type SlideParseContext } from './shape';
import { parseTextBody } from './text';
import type { PptxArchive } from './unzip';
import type { UploadImage } from './index';
import { child, descendant, parseXml } from './xml';

/** Maps from imported OOXML layout part path → the built-in layout id we chose. */
export type LayoutPathToId = Map<string, string>;

export interface ParseSlideOptions {
  archive: PptxArchive;
  /** e.g. `'ppt/slides/slide1.xml'` */
  partPath: string;
  /** Pre-built mapping for resolving each slide's layout rel to a built-in layout id. */
  layoutMap: LayoutPathToId;
  uploadImage?: UploadImage;
  scale: EmuScale;
  report: ImportReport;
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
  const layoutId = pickLayoutId(rels, opts.partPath, opts.layoutMap) ?? 'title-body';

  // Background may be on the slide's `<p:cSld>` (override) or inherited
  // from the master. v1 records an override only when present.
  const cSld = child(slideEl, 'cSld');
  const bgEl = cSld ? child(cSld, 'bg') : undefined;
  const background = bgEl ? parseSlideBackground(bgEl) : { ...DEFAULT_BACKGROUND };

  const spTree = cSld ? child(cSld, 'spTree') : undefined;
  const ctx: SlideParseContext = {
    archive: opts.archive,
    slidePartPath: opts.partPath,
    rels,
    uploadImage: opts.uploadImage,
    scale: opts.scale,
    report: opts.report,
    idMap: new Map(),
  };
  const elements = spTree ? await parseSpTree(spTree, ctx) : [];

  const notes = await parseNotes(opts.archive, opts.partPath, rels, opts.report);

  return {
    id: opts.partPath, // stable id keyed on source part path
    layoutId,
    background,
    elements,
    notes,
  };
}

function pickLayoutId(
  rels: Map<string, PptxRel>,
  slidePart: string,
  layoutMap: LayoutPathToId,
): string | undefined {
  for (const rel of rels.values()) {
    if (rel.type !== 'slideLayout') continue;
    const path = resolveRelsTarget(slidePart, rel.target);
    const mapped = layoutMap.get(path);
    if (mapped) return mapped;
  }
  return undefined;
}

function parseSlideBackground(bgEl: Element): Background {
  const bgPr = child(bgEl, 'bgPr');
  if (bgPr) {
    const solid = child(bgPr, 'solidFill');
    if (solid) {
      const color = parseColorFromContainer(solid);
      if (color) return { fill: color };
    }
  }
  return { ...DEFAULT_BACKGROUND };
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
  // `<p:notes><p:cSld><p:spTree>` holds the notes placeholders; we read
  // the body placeholder's <p:txBody>.
  const spTree = descendant(notesDoc, 'spTree');
  if (!spTree) return [];

  // Find the first `<p:sp>` whose `<p:nvSpPr><p:nvPr><p:ph type="body">`.
  // For v1 we take the largest text body content from the notes spTree.
  for (let i = 0; i < spTree.childNodes.length; i++) {
    const n = spTree.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.localName !== 'sp') continue;
    const txBody = child(el, 'txBody');
    if (!txBody) continue;
    return parseTextBody(txBody, { report });
  }
  return [];
}

function relsSiblingFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const dir = slash >= 0 ? partPath.slice(0, slash) : '';
  const file = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return (dir ? dir + '/' : '') + '_rels/' + file + '.rels';
}
