// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTheme } from './theme';

const YORKIE_THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Yorkie">
  <a:themeElements>
    <a:clrScheme name="Yorkie">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="158158"/></a:dk2>
      <a:lt2><a:srgbClr val="F3F3F3"/></a:lt2>
      <a:accent1><a:srgbClr val="058DC7"/></a:accent1>
      <a:accent2><a:srgbClr val="50B432"/></a:accent2>
      <a:accent3><a:srgbClr val="ED561B"/></a:accent3>
      <a:accent4><a:srgbClr val="EDEF00"/></a:accent4>
      <a:accent5><a:srgbClr val="24CBE5"/></a:accent5>
      <a:accent6><a:srgbClr val="64E572"/></a:accent6>
      <a:hlink><a:srgbClr val="2200CC"/></a:hlink>
      <a:folHlink><a:srgbClr val="551A8B"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Yorkie">
      <a:majorFont><a:latin typeface="Roboto"/></a:majorFont>
      <a:minorFont><a:latin typeface="Roboto"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office"/>
  </a:themeElements>
</a:theme>`;

describe('parseTheme', () => {
  it('extracts the Yorkie 캐즘 deck palette + Roboto', () => {
    const theme = parseTheme(YORKIE_THEME_XML, 'imported-yorkie');
    expect(theme.id).toBe('imported-yorkie');
    expect(theme.name).toBe('Yorkie');
    expect(theme.colors.accent1).toBe('#058DC7');
    expect(theme.colors.accent6).toBe('#64E572');
    expect(theme.colors.text).toBe('#000000');
    expect(theme.colors.background).toBe('#FFFFFF');
    expect(theme.colors.textSecondary).toBe('#158158');
    expect(theme.colors.hyperlink).toBe('#2200CC');
    expect(theme.colors.visitedHyperlink).toBe('#551A8B');
    expect(theme.fonts).toEqual({ heading: 'Roboto', body: 'Roboto' });
  });

  it('falls back to default-light values when slots are missing', () => {
    const empty = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements/></a:theme>`;
    const theme = parseTheme(empty, 'empty');
    expect(theme.colors.accent1).toBe('#1A73E8'); // default-light accent1
    expect(theme.fonts.heading).toBe('Inter');
  });

  it('keeps default fonts when only Latin face is blank (inherit)', () => {
    const xml = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Blank Fonts"><a:themeElements>
  <a:clrScheme name="X"/>
  <a:fontScheme name="X"><a:majorFont><a:latin typeface=""/></a:majorFont><a:minorFont><a:latin typeface=""/></a:minorFont></a:fontScheme>
</a:themeElements></a:theme>`;
    const theme = parseTheme(xml, 't');
    expect(theme.fonts).toEqual({ heading: 'Inter', body: 'Inter' });
  });
});
