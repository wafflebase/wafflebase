import type { Master } from '../../model/master.js';
import { representativeColor } from '../../model/theme.js';
import { solidFillXml } from './color.js';

/**
 * Default OOXML `<p:clrMap>` attribute string (identity mapping).
 *
 * The master's clrMap translates logical slot aliases (bg1/tx1/bg2/tx2) to
 * actual scheme slot names. The default OOXML mapping is:
 *   bg1→lt1, tx1→dk1, bg2→lt2, tx2→dk2; accent/hlink are identity.
 * We emit the identity mapping explicitly so PowerPoint reads the file cleanly.
 */
const DEFAULT_CLR_MAP_ATTRS =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" ' +
  'accent1="accent1" accent2="accent2" accent3="accent3" ' +
  'accent4="accent4" accent5="accent5" accent6="accent6" ' +
  'hlink="hlink" folHlink="folHlink"';

/**
 * Serialize a `Master` to `ppt/slideMasters/slideMasterN.xml` content.
 *
 * v1 scope:
 * - Background fill from `master.background.fill` (solid ThemeColor).
 *   A gradient master background collapses to its representative
 *   (first-stop) color — full gradient background export is a later task.
 * - Standard `<p:clrMap>` with the OOXML identity mapping.
 * - Empty `<p:sldLayoutIdLst>` — the orchestrator fills in layout rels.
 * - No `<p:txStyles>` — placeholder typography overrides are deferred to v1.5.
 */
export function masterToXml(master: Master, _index: number): string {
  const bgFill = solidFillXml(representativeColor(master.background.fill));

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sldMaster` +
    ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    `>` +
    `<p:cSld>` +
    `<p:bg><p:bgPr>${bgFill}</p:bgPr></p:bg>` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMap ${DEFAULT_CLR_MAP_ATTRS}/>` +
    `<p:sldLayoutIdLst/>` +
    `</p:sldMaster>`
  );
}

