/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { html2grid, isSpreadsheetHtml, cssColorToHex, grid2string, string2grid } from '../../src/model/grids';

describe('cssColorToHex', () => {
  it('should convert rgb to hex', () => {
    expect(cssColorToHex('rgb(255, 0, 0)')).toBe('#ff0000');
  });

  it('should pad single-digit hex values', () => {
    expect(cssColorToHex('rgb(1, 2, 3)')).toBe('#010203');
  });

  it('should return undefined for white', () => {
    expect(cssColorToHex('rgb(255, 255, 255)')).toBeUndefined();
  });

  it('should return undefined for unrecognized formats', () => {
    expect(cssColorToHex('red')).toBeUndefined();
  });
});

describe('isSpreadsheetHtml', () => {
  it('should detect Google Sheets HTML', () => {
    expect(isSpreadsheetHtml('<meta name="google-sheets-html-origin">')).toBe(true);
  });

  it('should detect data-sheets-value attribute', () => {
    expect(isSpreadsheetHtml('<td data-sheets-value="test">')).toBe(true);
  });

  it('should detect Excel HTML', () => {
    expect(isSpreadsheetHtml('<html xmlns:x="urn:schemas-microsoft-com:office:excel">')).toBe(true);
  });

  it('should return false for plain HTML', () => {
    expect(isSpreadsheetHtml('<table><tr><td>hello</td></tr></table>')).toBe(false);
  });
});

describe('html2grid', () => {
  it('should parse a simple HTML table', () => {
    const html = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
    const grid = html2grid(html, { r: 1, c: 1 });

    expect(grid.get('A1')?.v).toBe('A');
    expect(grid.get('B1')?.v).toBe('B');
    expect(grid.get('A2')?.v).toBe('C');
    expect(grid.get('B2')?.v).toBe('D');
    expect(grid.size).toBe(4);
  });

  it('should position grid at destRef', () => {
    const html = '<table><tr><td>X</td></tr></table>';
    const grid = html2grid(html, { r: 3, c: 2 });

    expect(grid.get('B3')?.v).toBe('X');
    expect(grid.size).toBe(1);
  });

  it('should extract bold style', () => {
    const html = '<table><tr><td style="font-weight:bold">Bold</td></tr></table>';
    const grid = html2grid(html, { r: 1, c: 1 });

    expect(grid.get('A1')?.s?.b).toBe(true);
  });

  it('should extract italic style', () => {
    const html = '<table><tr><td style="font-style:italic">Italic</td></tr></table>';
    const grid = html2grid(html, { r: 1, c: 1 });

    expect(grid.get('A1')?.s?.i).toBe(true);
  });

  it('should extract background color', () => {
    const html = '<table><tr><td style="background-color:rgb(255, 0, 0)">Red</td></tr></table>';
    const grid = html2grid(html, { r: 1, c: 1 });

    expect(grid.get('A1')?.s?.bg).toBe('#ff0000');
  });

  it('should extract text color', () => {
    const html = '<table><tr><td style="color:rgb(0, 0, 255)">Blue</td></tr></table>';
    const grid = html2grid(html, { r: 1, c: 1 });

    expect(grid.get('A1')?.s?.tc).toBe('#0000ff');
  });

  it('should extract text alignment', () => {
    const html = '<table><tr><td style="text-align:center">Centered</td></tr></table>';
    const grid = html2grid(html, { r: 1, c: 1 });

    expect(grid.get('A1')?.s?.al).toBe('center');
  });

  it('should return empty grid for HTML without table', () => {
    const html = '<div>no table here</div>';
    const grid = html2grid(html, { r: 1, c: 1 });

    expect(grid.size).toBe(0);
  });
});

describe('grid2string', () => {
  it('should convert grid to TSV', () => {
    const grid = new Map<string, { v?: string; f?: string }>([
      ['A1', { v: '10' }],
      ['B1', { v: '20' }],
      ['A2', { v: '30' }],
    ]);

    expect(grid2string(grid)).toBe('10\t20\n30\t');
  });
});

describe('string2grid', () => {
  it('should convert TSV to grid', () => {
    const grid = string2grid({ r: 1, c: 1 }, '10\t20\n30\t40');

    expect(grid.get('A1')?.v).toBe('10');
    expect(grid.get('B1')?.v).toBe('20');
    expect(grid.get('A2')?.v).toBe('30');
    expect(grid.get('B2')?.v).toBe('40');
  });
});
