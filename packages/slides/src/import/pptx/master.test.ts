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
    const m = parseMaster(MIN_MASTER, 'master-1', 'imported-yorkie');
    expect(m.id).toBe('master-1');
    expect(m.themeId).toBe('imported-yorkie');
    expect(m.background.fill).toEqual({ kind: 'role', role: 'background' });
  });

  it('captures a literal sRGB background', () => {
    const m = parseMaster(SRGB_MASTER, 'm', 't');
    expect(m.background.fill).toEqual({ kind: 'srgb', value: '#F3F3F3' });
  });

  it('inherits the default placeholder-style table for now', () => {
    const m = parseMaster(MIN_MASTER, 'm', 't');
    expect(m.placeholderStyles.title.fontSize).toBe(44);
    expect(m.placeholderStyles.body.fontSize).toBe(18);
  });
});
