// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseMaster } from './master';

const MIN_MASTER = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldMaster>`;

const SRGB_MASTER = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="F3F3F3"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldMaster>`;

describe('parseMaster', () => {
  it('captures the master background as a theme-bound role', () => {
    const { master, clrMap } = parseMaster(MIN_MASTER, 'master-1', 'imported-yorkie');
    expect(master.id).toBe('master-1');
    expect(master.themeId).toBe('imported-yorkie');
    expect(master.background.fill).toEqual({ kind: 'role', role: 'background' });
    expect(clrMap.size).toBe(0); // identity (no <p:clrMap>)
  });

  it('captures a literal sRGB background', () => {
    const { master } = parseMaster(SRGB_MASTER, 'm', 't');
    expect(master.background.fill).toEqual({ kind: 'srgb', value: '#F3F3F3' });
  });

  it('inherits the default placeholder-style table for now', () => {
    const { master } = parseMaster(MIN_MASTER, 'm', 't');
    expect(master.placeholderStyles.title.fontSize).toBe(44);
    expect(master.placeholderStyles.body.fontSize).toBe(18);
  });

  it('parses non-identity <p:clrMap> mappings (benchmark deck swaps bg2/tx2)', () => {
    const xml = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree/></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="dk2" tx2="lt2"
            accent1="accent1" accent2="accent2" accent3="accent3"
            accent4="accent4" accent5="accent5" accent6="accent6"
            hlink="hlink" folHlink="folHlink"/>
</p:sldMaster>`;
    const { clrMap } = parseMaster(xml, 'm', 't');
    // Identity entries skipped; only the swaps land in the map.
    expect(clrMap.get('bg2')).toBe('dk2');
    expect(clrMap.get('tx2')).toBe('lt2');
    expect(clrMap.has('bg1')).toBe(false);
    expect(clrMap.has('accent1')).toBe(false);
  });
});
