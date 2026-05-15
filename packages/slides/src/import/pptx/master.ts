import type { Master, MasterBackground } from '../../model/master';
import { DEFAULT_MASTER } from '../../model/master';
import { parseColorFromContainer } from './color';
import { child, descendant, parseXml } from './xml';

/**
 * Parse `ppt/slideMasters/slideMaster1.xml` into a `Master`.
 *
 * v1 scope: read just the master-level background and inherit the rest
 * of the placeholder-style table from `DEFAULT_MASTER`. Per-placeholder
 * style overrides on the master are reachable via `<p:txStyles>` and
 * will land alongside Task 3 text parsing — the first consumer is the
 * docs-style block emitter, not the master importer itself.
 */
export function parseMaster(xml: string, id: string, themeId: string): Master {
  const doc = parseXml(xml);
  const sldMaster = descendant(doc, 'sldMaster');
  const cSld = sldMaster ? child(sldMaster, 'cSld') : undefined;
  const bg = cSld ? child(cSld, 'bg') : undefined;

  const background = bg ? parseBackground(bg) : { ...DEFAULT_MASTER.background };

  return {
    id,
    themeId,
    background,
    placeholderStyles: { ...DEFAULT_MASTER.placeholderStyles },
  };
}

function parseBackground(bg: Element): MasterBackground {
  // `<p:bg>` wraps either `<p:bgPr>` (literal fill) or `<p:bgRef>` (style
  // matrix index). v1 supports only `bgPr → solidFill` and falls back
  // for anything else.
  const bgPr = child(bg, 'bgPr');
  if (bgPr) {
    const solid = child(bgPr, 'solidFill');
    if (solid) {
      const color = parseColorFromContainer(solid);
      if (color) return { fill: color };
    }
  }
  return { ...DEFAULT_MASTER.background };
}
