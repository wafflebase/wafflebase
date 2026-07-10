import type { SlidesDocument, Layout, Slide } from '../../model/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../model/presentation';
import type { Master } from '../../model/master';
import { DEFAULT_MASTER } from '../../model/master';
import { BUILT_IN_LAYOUTS, scaleLayoutsToHeight } from '../../model/layout';
import { BUILT_IN_THEMES } from '../../themes';
import type { Theme } from '../../model/theme';
import type { ClrMap } from './color';
import { emuScale, deckLogicalHeight, DEFAULT_WIDESCREEN_EMU, EMU_PER_INCH } from './geometry';
import { parseSlide, type LayoutPathToInfo } from './slide';
import { unzipPptx, type PptxArchive } from './unzip';
import { ImportReport } from './report';
import { parseRels, resolveRelsTarget } from './rels';
import { parseTheme } from './theme';
import { parseMaster, type TxStylesMarkers } from './master';
import { parseLayout } from './layout';
import { attrInt, children, descendant, parseXml, NS } from './xml';

/** Points per inch — the typographic constant `pt = 1/72 in`. */
const POINTS_PER_INCH = 72;
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
  // Per-deck logical height (width fixed at 1920). Drives both the layout
  // placeholder rescale below and `meta.slideHeight` further down.
  const logicalHeight = deckLogicalHeight(slideSizeEmu);

  // Resolve presentation.xml.rels → theme + master + slide targets.
  const presRelsXml = await archive.readText('ppt/_rels/presentation.xml.rels');
  const presRels = presRelsXml ? parseRels(presRelsXml) : new Map();

  const themeTarget = pickRelTarget(presRels, 'theme');

  const importedTheme = themeTarget
    ? await loadTheme(archive, 'ppt/presentation.xml', themeTarget)
    : undefined;

  // A deck can carry several slide masters, each owning its own set of
  // layouts (e.g. this deck's slide 1 layout — with its gradient background
  // image — lives under master 1, while another master owns the rest). Load
  // every master in `<p:sldMasterIdLst>` order and merge their layouts /
  // layoutMaps so every slide can resolve its real layout. The first master
  // is the primary: its color map, txStyles, and background drive the deck
  // (our model still stores a single `masterId`).
  const masterTargets = orderedMasterTargets(presentation, presRels);
  let masterAndLayouts: {
    master: Master | undefined;
    layouts: Layout[];
    layoutMap: LayoutPathToInfo;
    clrMap: ClrMap;
    txStylesMarkers: TxStylesMarkers;
  } = {
    master: undefined,
    layouts: [],
    layoutMap: new Map(),
    clrMap: new Map(),
    txStylesMarkers: new Map(),
  };
  for (const masterTarget of masterTargets) {
    const loaded = await loadMasterAndLayouts(
      archive,
      'ppt/presentation.xml',
      masterTarget,
      importedTheme?.id ?? 'default-light',
      report,
      upload,
      scale,
    );
    if (!masterAndLayouts.master) {
      // Primary master: keep its master/clrMap/txStyles; seed the merged
      // layouts + layoutMap.
      masterAndLayouts = {
        master: loaded.master,
        layouts: [...loaded.layouts],
        layoutMap: new Map(loaded.layoutMap),
        clrMap: loaded.clrMap,
        txStylesMarkers: loaded.txStylesMarkers,
      };
    } else {
      // Secondary masters contribute only their layouts (paths are unique,
      // so no layoutMap collision); slides under them still resolve.
      masterAndLayouts.layouts.push(...loaded.layouts);
      for (const [path, info] of loaded.layoutMap) {
        masterAndLayouts.layoutMap.set(path, info);
      }
    }
  }

  const themes: Theme[] = importedTheme
    ? [importedTheme, ...BUILT_IN_THEMES.filter((t) => t.id !== importedTheme.id)]
    : [...BUILT_IN_THEMES];
  const masters: Master[] = masterAndLayouts.master
    ? [masterAndLayouts.master]
    : [DEFAULT_MASTER];
  // Built-in layouts are always available; imported layouts ride on top
  // (deduped by id — multiple OOXML layouts can collapse onto the same
  // built-in, and storing duplicates would break BUILT_IN_LAYOUTS' usage
  // as the picker's source of truth). Built-ins are rescaled to the deck's
  // logical height so their placeholders stay centred on a non-16:9 deck;
  // imported layouts already carry deck-space frames and are left as-is.
  //
  // Layout-level `<p:bg>` (e.g. slide 1's gradient background image) is NOT
  // carried on these collapsed layouts: several OOXML layouts map to one
  // built-in id, so a per-id background would be ambiguous. Instead each
  // slide bakes its own layout's background at parse time (see `parseSlide`),
  // keyed on the exact layout part path via `layoutMap`.
  const layouts = dedupeLayouts([
    ...scaleLayoutsToHeight(BUILT_IN_LAYOUTS, logicalHeight),
    ...masterAndLayouts.layouts,
  ]);

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
      txStylesMarkers: masterAndLayouts.txStylesMarkers,
    });
    if (slide) slides.push(slide);
  }

  // px-per-pt for the deck's physical size. The 1920-px canvas
  // represents the source deck's full width; convert that width into
  // inches via EMU, then pts via 72 pts/in. A 13.333-inch widescreen
  // lands on `2`; a 10-inch deck (Google Slides' historical default)
  // on `≈2.667`. The renderer reads this off `meta` so committed text
  // and in-place editing pick up the same scale.
  const slideWidthInches = slideSizeEmu.cx / EMU_PER_INCH;
  const pxPerPt =
    slideWidthInches > 0 ? SLIDE_WIDTH / (slideWidthInches * POINTS_PER_INCH) : undefined;

  // `logicalHeight` (computed above) records a taller/shorter canvas for
  // a non-16:9 deck; a 16:9 deck lands on 1080 and is left absent so
  // authored decks keep their existing JSON shape.
  const document: SlidesDocument = {
    meta: {
      title: 'Imported deck',
      themeId: importedTheme?.id ?? 'default-light',
      masterId: masterAndLayouts.master?.id ?? 'default',
      ...(pxPerPt != null ? { pxPerPt } : {}),
      ...(logicalHeight !== SLIDE_HEIGHT ? { slideHeight: logicalHeight } : {}),
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

/**
 * Slide-master part targets in `<p:sldMasterIdLst>` order (the first entry is
 * the presentation's primary master). Falls back to every `slideMaster` rel
 * in rels order when the list is absent. Returns raw rel targets (relative to
 * `ppt/presentation.xml`), de-duplicated.
 */
function orderedMasterTargets(
  presentation: Document,
  presRels: Map<string, { type: string; target: string }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const lst = descendant(presentation, 'sldMasterIdLst');
  if (lst) {
    for (const sldMasterId of children(lst, 'sldMasterId')) {
      const rid =
        sldMasterId.getAttributeNS(NS.R, 'id') ||
        sldMasterId.getAttribute('r:id') ||
        undefined;
      if (!rid) continue;
      const rel = presRels.get(rid);
      if (!rel || rel.type !== 'slideMaster' || seen.has(rel.target)) continue;
      seen.add(rel.target);
      out.push(rel.target);
    }
  }
  if (out.length === 0) {
    for (const rel of presRels.values()) {
      if (rel.type !== 'slideMaster' || seen.has(rel.target)) continue;
      seen.add(rel.target);
      out.push(rel.target);
    }
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
  txStylesMarkers: TxStylesMarkers;
}> {
  const masterPath = resolveRelsTarget(ownerPart, masterTarget);
  const masterXml = await archive.readText(masterPath);
  if (!masterXml) {
    return {
      master: undefined,
      layouts: [],
      layoutMap: new Map(),
      clrMap: new Map(),
      txStylesMarkers: new Map(),
    };
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
  const { master, clrMap, txStylesMarkers } = await parseMaster(
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
    // A layout's own rels resolve its `<p:bg>` blipFill image (distinct
    // from the master rels used to find the layout part itself).
    const layoutRelsXml = await archive.readText(relsSiblingFor(layoutPath));
    const layoutRels = layoutRelsXml ? parseRels(layoutRelsXml) : new Map();
    const layoutImageCtx: ImageParseContext = {
      archive,
      slidePartPath: layoutPath,
      rels: layoutRels,
      uploadImage,
      scale,
      report,
    };
    const imported = await parseLayout(layoutXml, layoutPath, report, {
      imageCtx: layoutImageCtx,
      clrMap,
    });
    layouts.push(imported.layout);
    // Key the layout's background on its exact part path so the slide that
    // references it can bake the right background (the collapsed built-in id
    // is shared by several layouts and would be ambiguous).
    layoutMap.set(layoutPath, {
      builtInId: imported.layout.id,
      placeholderSizes: imported.placeholderSizes,
      placeholderFrames: imported.placeholderFrames,
      ...(imported.background && { background: imported.background }),
    });
  }

  return { master, layouts, layoutMap, clrMap, txStylesMarkers };
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
