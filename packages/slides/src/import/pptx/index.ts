import type { SlidesDocument, Layout, Slide } from '../../model/presentation';
import type { Master } from '../../model/master';
import { DEFAULT_MASTER } from '../../model/master';
import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { BUILT_IN_THEMES } from '../../themes';
import type { Theme } from '../../model/theme';
import type { ClrMap } from './color';
import { emuScale, DEFAULT_WIDESCREEN_EMU } from './geometry';
import { parseSlide, type LayoutPathToInfo } from './slide';
import { unzipPptx, type PptxArchive } from './unzip';
import { ImportReport } from './report';
import { parseRels, resolveRelsTarget } from './rels';
import { parseTheme } from './theme';
import { parseMaster } from './master';
import { parseLayout } from './layout';
import { attrInt, children, descendant, parseXml, NS } from './xml';
import type { ImageParseContext } from './image';
import { EXT_TO_MIME } from './image';

export type UploadImage = (bytes: Uint8Array, mime: string) => Promise<string>;

export interface ImportPptxOptions {
  /**
   * Called once per `<p:pic>` embedded blob. Returns the URL to store
   * on the resulting `ImageElement`. The caller is responsible for
   * routing to the workspace's `/images` endpoint.
   *
   * Required for decks with images. Omitted for fixtures / dry runs.
   */
  uploadImage?: UploadImage;
  /**
   * Called once with `(0, total)` right after the archive is unzipped,
   * then once after every image upload attempt with the running
   * `(done, total)`. `total` is the count of image files under
   * `ppt/media/` — a pragmatic denominator that matches the upload
   * count for virtually all decks. Drives the import progress toast.
   */
  onProgress?: (done: number, total: number) => void;
}

export interface ImportPptxResult {
  document: SlidesDocument;
  report: ImportReport;
}

/** EMU dimensions of the source deck — captured for the geometry scale. */
export interface SourceSlideSize {
  cx: number;
  cy: number;
}

/**
 * Best-effort import of a `.pptx` archive into a `SlidesDocument`.
 *
 * Task 2 wires in theme / master / layout. Slides + element parsing
 * land in Task 3; the document returns with an empty `slides[]` until
 * then.
 *
 * Node consumers must polyfill `DOMParser` before calling this. The
 * CLI's `dom-polyfill.ts` already does so for the docs importer.
 */
export async function importPptx(
  buffer: ArrayBuffer,
  opts: ImportPptxOptions = {},
): Promise<ImportPptxResult> {
  const archive = await unzipPptx(buffer);
  const report = new ImportReport();

  // Wrap the host uploader so the importer can report progress without
  // threading a counter through every parse context. `total` is the
  // image-media count (a pragmatic denominator); `done` bumps in a
  // `finally` so a soft-failed upload still advances the bar.
  let upload = opts.uploadImage;
  if (opts.onProgress) {
    const emit = opts.onProgress;
    const total = archive
      .list('ppt/media/')
      .filter((p) => (p.split('.').pop()?.toLowerCase() ?? '') in EXT_TO_MIME)
      .length;
    emit(0, total);
    if (opts.uploadImage) {
      const inner = opts.uploadImage;
      let done = 0;
      upload = async (bytes: Uint8Array, mime: string): Promise<string> => {
        try {
          return await inner(bytes, mime);
        } finally {
          done += 1;
          emit(done, total);
        }
      };
    }
  }

  const presentationXml = await archive.readText('ppt/presentation.xml');
  if (!presentationXml) {
    throw new Error('Invalid .pptx: missing ppt/presentation.xml');
  }
  const presentation = parseXml(presentationXml);

  const slideSizeEmu = readSlideSize(presentation);
  const scale = emuScale(slideSizeEmu);

  // Resolve presentation.xml.rels → theme + master + slide targets.
  const presRelsXml = await archive.readText('ppt/_rels/presentation.xml.rels');
  const presRels = presRelsXml ? parseRels(presRelsXml) : new Map();

  const themeTarget = pickRelTarget(presRels, 'theme');
  const masterTarget = pickRelTarget(presRels, 'slideMaster');

  const importedTheme = themeTarget
    ? await loadTheme(archive, 'ppt/presentation.xml', themeTarget)
    : undefined;

  const masterAndLayouts = masterTarget
    ? await loadMasterAndLayouts(
        archive,
        'ppt/presentation.xml',
        masterTarget,
        importedTheme?.id ?? 'default-light',
        report,
        upload,
        scale,
      )
    : {
        master: undefined,
        layouts: [] as Layout[],
        layoutMap: new Map() as LayoutPathToInfo,
        clrMap: new Map() as ClrMap,
      };

  const themes: Theme[] = importedTheme
    ? [importedTheme, ...BUILT_IN_THEMES.filter((t) => t.id !== importedTheme.id)]
    : [...BUILT_IN_THEMES];
  const masters: Master[] = masterAndLayouts.master
    ? [masterAndLayouts.master]
    : [DEFAULT_MASTER];
  // Built-in layouts are always available; imported layouts ride on top
  // (deduped by id — multiple OOXML layouts can collapse onto the same
  // built-in, and storing duplicates would break BUILT_IN_LAYOUTS' usage
  // as the picker's source of truth).
  const layouts = dedupeLayouts([...BUILT_IN_LAYOUTS, ...masterAndLayouts.layouts]);

  // Slides — resolve in source order from `<p:sldIdLst>`. Each entry's
  // `r:id` points into `presRels` at the slide part path.
  const slidePartPaths = orderedSlidePaths(presentation, presRels);
  const slides: Slide[] = [];
  for (const path of slidePartPaths) {
    const slide = await parseSlide({
      archive,
      partPath: path,
      layoutMap: masterAndLayouts.layoutMap,
      uploadImage: upload,
      scale,
      report,
      clrMap: masterAndLayouts.clrMap,
    });
    if (slide) slides.push(slide);
  }

  const document: SlidesDocument = {
    meta: {
      title: 'Imported deck',
      themeId: importedTheme?.id ?? 'default-light',
      masterId: masterAndLayouts.master?.id ?? 'default',
    },
    themes,
    masters,
    layouts,
    slides,
    guides: [],
  };

  return { document, report };
}

function orderedSlidePaths(
  presentation: Document,
  presRels: Map<string, { type: string; target: string }>,
): string[] {
  const sldIdLst = descendant(presentation, 'sldIdLst');
  if (!sldIdLst) return [];
  const out: string[] = [];
  for (const sldId of children(sldIdLst, 'sldId')) {
    const rid =
      sldId.getAttributeNS(NS.R, 'id') || sldId.getAttribute('r:id') || undefined;
    if (!rid) continue;
    const rel = presRels.get(rid);
    if (!rel || rel.type !== 'slide') continue;
    out.push(resolveRelsTarget('ppt/presentation.xml', rel.target));
  }
  return out;
}

function readSlideSize(presentation: Document): SourceSlideSize {
  const sldSz = descendant(presentation, 'sldSz');
  if (!sldSz) return { ...DEFAULT_WIDESCREEN_EMU };
  return {
    cx: attrInt(sldSz, 'cx') ?? DEFAULT_WIDESCREEN_EMU.cx,
    cy: attrInt(sldSz, 'cy') ?? DEFAULT_WIDESCREEN_EMU.cy,
  };
}

function pickRelTarget(
  rels: Map<string, { type: string; target: string }>,
  type: string,
): string | undefined {
  for (const rel of rels.values()) {
    if (rel.type === type) return rel.target;
  }
  return undefined;
}

async function loadTheme(
  archive: PptxArchive,
  ownerPart: string,
  target: string,
): Promise<Theme | undefined> {
  const path = resolveRelsTarget(ownerPart, target);
  const xml = await archive.readText(path);
  if (!xml) return undefined;
  // Stable id keyed on the source path keeps imported themes distinct
  // from the built-ins even if multiple decks share the OOXML name "Office".
  return parseTheme(xml, `imported-${path}`);
}

async function loadMasterAndLayouts(
  archive: PptxArchive,
  ownerPart: string,
  masterTarget: string,
  themeId: string,
  report: ImportReport,
  uploadImage: UploadImage | undefined,
  scale: ReturnType<typeof emuScale>,
): Promise<{
  master: Master | undefined;
  layouts: Layout[];
  layoutMap: LayoutPathToInfo;
  clrMap: ClrMap;
}> {
  const masterPath = resolveRelsTarget(ownerPart, masterTarget);
  const masterXml = await archive.readText(masterPath);
  if (!masterXml) {
    return { master: undefined, layouts: [], layoutMap: new Map(), clrMap: new Map() };
  }

  // Each master's rels file lists the slideLayouts it owns. We import
  // them all; slides resolve to one via their own rels file. Loaded
  // before `parseMaster` so the same `rels` map can resolve any
  // master-level blipFill background.
  const relsPath = relsSiblingFor(masterPath);
  const relsXml = await archive.readText(relsPath);
  const rels = relsXml ? parseRels(relsXml) : new Map();

  const masterImageCtx: ImageParseContext = {
    archive,
    slidePartPath: masterPath,
    rels,
    uploadImage,
    scale,
    report,
  };
  const { master, clrMap } = await parseMaster(
    masterXml,
    `imported-${masterPath}`,
    themeId,
    masterImageCtx,
  );

  const layouts: Layout[] = [];
  const layoutMap: LayoutPathToInfo = new Map();
  for (const rel of rels.values()) {
    if (rel.type !== 'slideLayout') continue;
    const layoutPath = resolveRelsTarget(masterPath, rel.target);
    const layoutXml = await archive.readText(layoutPath);
    if (!layoutXml) continue;
    const imported = parseLayout(layoutXml, layoutPath, report);
    layouts.push(imported.layout);
    layoutMap.set(layoutPath, {
      builtInId: imported.layout.id,
      placeholderSizes: imported.placeholderSizes,
    });
  }

  return { master, layouts, layoutMap, clrMap };
}

/** `ppt/slideMasters/slideMaster1.xml` → `ppt/slideMasters/_rels/slideMaster1.xml.rels`. */
function relsSiblingFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const dir = slash >= 0 ? partPath.slice(0, slash) : '';
  const file = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return (dir ? dir + '/' : '') + '_rels/' + file + '.rels';
}

function dedupeLayouts(layouts: Layout[]): Layout[] {
  const seen = new Set<string>();
  const out: Layout[] = [];
  for (const layout of layouts) {
    if (seen.has(layout.id)) continue;
    seen.add(layout.id);
    out.push(layout);
  }
  return out;
}
