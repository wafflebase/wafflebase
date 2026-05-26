import type { Master, MasterBackground } from '../../model/master';
import { DEFAULT_MASTER } from '../../model/master';
import { clone } from '../../model/clone';
import { parseColorFromContainer, type ClrMap } from './color';
import { parseBlipFill, type ImageParseContext } from './image';
import { attr, child, descendant, parseXml } from './xml';

/**
 * OOXML `<p:clrMap>` attributes — translation table from logical
 * scheme tokens (`bg1` / `bg2` / `tx1` / `tx2` / `accent1..6` /
 * `hlink` / `folHlink`) to actual scheme slot names. Real-world decks
 * (including the Yorkie 캐즘 benchmark) emit non-identity mappings
 * — e.g. `bg2="dk2"` swaps `bg2` away from its default `lt2` slot.
 */
const CLR_MAP_KEYS = [
  'bg1', 'tx1', 'bg2', 'tx2',
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
  'hlink', 'folHlink',
] as const;

/**
 * Parse `ppt/slideMasters/slideMaster1.xml` into a `Master`.
 *
 * v1 scope: read just the master-level background and inherit the rest
 * of the placeholder-style table from `DEFAULT_MASTER`. Per-placeholder
 * style overrides on the master are reachable via `<p:txStyles>` and
 * will land alongside Task 3 text parsing — the first consumer is the
 * docs-style block emitter, not the master importer itself.
 */
export interface ImportedMaster {
  master: Master;
  /** Translation table from the master's `<p:clrMap>` for slide-level color resolution. */
  clrMap: ClrMap;
}

export async function parseMaster(
  xml: string,
  id: string,
  themeId: string,
  imageCtx: ImageParseContext,
): Promise<ImportedMaster> {
  const doc = parseXml(xml);
  const sldMaster = descendant(doc, 'sldMaster');
  const cSld = sldMaster ? child(sldMaster, 'cSld') : undefined;
  const bg = cSld ? child(cSld, 'bg') : undefined;
  const clrMap = sldMaster ? parseClrMap(sldMaster) : new Map<string, string>();

  // Master `<p:bg>` is parsed without `clrMap` — backgrounds almost
  // always use direct scheme slot names (`lt1` / `dk1`) rather than the
  // logical `bg1` / `tx1` aliases that `<p:clrMap>` rewires.
  const background = bg
    ? await parseBackground(bg, imageCtx)
    : clone(DEFAULT_MASTER.background);

  // `clone()` deep-copies so the imported master can mutate its
  // background / placeholderStyles without leaking back into
  // `DEFAULT_MASTER` (which is read-only by intent — many decks share
  // it via module identity).
  return {
    master: {
      id,
      themeId,
      background,
      placeholderStyles: clone(DEFAULT_MASTER.placeholderStyles),
    },
    clrMap,
  };
}

/**
 * Default OOXML clrMap (the implicit mapping when `<p:clrMap>` is
 * omitted). Identity for accent / hlink slots; aliases bg1/tx1/bg2/tx2
 * to their default scheme slot names.
 */
const DEFAULT_CLR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
};

function parseClrMap(sldMaster: Element): ClrMap {
  const map = new Map<string, string>();
  const el = child(sldMaster, 'clrMap');
  if (!el) return map;
  for (const key of CLR_MAP_KEYS) {
    const value = attr(el, key);
    // Skip identity (matches OOXML default) — keeps the map sparse and
    // makes test assertions clearer. Non-identity entries are what
    // matter at color-resolution time.
    if (value && value !== DEFAULT_CLR_MAP[key]) map.set(key, value);
  }
  return map;
}

async function parseBackground(
  bg: Element,
  imageCtx: ImageParseContext,
): Promise<MasterBackground> {
  // `<p:bg>` wraps either `<p:bgPr>` (literal fill) or `<p:bgRef>` (style
  // matrix index). v2 adds blipFill alongside solidFill; bgRef is still
  // unhandled and falls through to the default.
  const bgPr = child(bg, 'bgPr');
  if (bgPr) {
    const blipFill = child(bgPr, 'blipFill');
    if (blipFill) {
      const blip = await parseBlipFill(blipFill, imageCtx);
      if (blip) {
        return { fill: clone(DEFAULT_MASTER.background).fill, image: blip };
      }
    }
    const solid = child(bgPr, 'solidFill');
    if (solid) {
      const color = parseColorFromContainer(solid);
      if (color) return { fill: color };
    }
  }
  return clone(DEFAULT_MASTER.background);
}
