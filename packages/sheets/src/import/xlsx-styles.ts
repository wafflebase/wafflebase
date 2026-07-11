import type {
  CellStyle,
  NumberFormat,
  TextAlign,
  VerticalAlign,
} from '../model/core/types';
import {
  childrenByLocalName,
  directChildren,
  firstChildByLocalName,
  firstDirectChild,
  tryParseXml,
} from './xlsx-xml';

/**
 * Parsed style table from `xl/styles.xml`, indexable by a cell's `s` attribute.
 *
 * Phase 1 of XLSX style import — see docs/design/sheets/xlsx-style-import.md.
 * Only the properties the `CellStyle` model can already represent are resolved
 * (fills, borders, bold/italic/underline/strike, text color, alignment, number
 * format). Font family/size and hyperlinks are deferred to a later phase.
 */
export type StyleTable = {
  resolveCellStyle(s: number | undefined): CellStyle | undefined;
};

type Font = {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  st?: boolean;
  color?: string;
};

type Border = {
  bl?: boolean;
  br?: boolean;
  bt?: boolean;
  bb?: boolean;
};

type CellXf = {
  fontId: number;
  fillId: number;
  borderId: number;
  numFmtId: number;
  al?: TextAlign;
  va?: VerticalAlign;
};

/**
 * Normalizes an XLSX ARGB/RGB color to a `#RRGGBB` string.
 * Leading alpha bytes (e.g. `FF` in `FFRRGGBB`) are stripped.
 */
export function normalizeColor(
  rgb: string | null | undefined,
): string | undefined {
  if (!rgb) {
    return undefined;
  }
  const hex = rgb.trim().replace(/^#/, '');
  if (hex.length === 8) {
    return `#${hex.slice(2).toUpperCase()}`;
  }
  if (hex.length === 6) {
    return `#${hex.toUpperCase()}`;
  }
  return undefined;
}

// Minimal theme→RGB fallback. Excel theme slot 1 is the primary text color
// (black); slot 0 the primary background (white). Others fall back to undefined.
const THEME_COLORS: Record<string, string> = {
  '0': '#FFFFFF',
  '1': '#000000',
};

function readColor(el: Element | null): string | undefined {
  if (!el) {
    return undefined;
  }
  const rgb = normalizeColor(el.getAttribute('rgb'));
  if (rgb) {
    return rgb;
  }
  const theme = el.getAttribute('theme');
  if (theme && theme in THEME_COLORS) {
    return THEME_COLORS[theme];
  }
  return undefined;
}

/**
 * Reads a boolean font toggle (`<b/>`, `<i/>`, ...). The element being present
 * means "on" unless it carries an explicit `val="0"`/`"false"`/`"none"`, which
 * Excel emits when a style overrides an inherited property to off.
 */
function readFontToggle(font: Element, name: string): boolean {
  const el = firstDirectChild(font, name);
  if (!el) {
    return false;
  }
  const val = el.getAttribute('val');
  return val !== '0' && val !== 'false' && val !== 'none';
}

function parseFonts(root: Document): Font[] {
  const fontsEl = firstChildByLocalName(root, 'fonts');
  if (!fontsEl) {
    return [];
  }
  return directChildren(fontsEl, 'font').map((font) => {
    const parsed: Font = {};
    if (readFontToggle(font, 'b')) parsed.b = true;
    if (readFontToggle(font, 'i')) parsed.i = true;
    if (readFontToggle(font, 'u')) parsed.u = true;
    if (readFontToggle(font, 'strike')) parsed.st = true;
    parsed.color = readColor(firstDirectChild(font, 'color'));
    return parsed;
  });
}

function parseFills(root: Document): Array<string | undefined> {
  const fillsEl = firstChildByLocalName(root, 'fills');
  if (!fillsEl) {
    return [];
  }
  return directChildren(fillsEl, 'fill').map((fill) => {
    const pattern = firstDirectChild(fill, 'patternFill');
    if (!pattern || pattern.getAttribute('patternType') !== 'solid') {
      return undefined;
    }
    return readColor(firstDirectChild(pattern, 'fgColor'));
  });
}

function sideHasBorder(border: Element, side: string): boolean {
  const el = firstDirectChild(border, side);
  const style = el?.getAttribute('style');
  return !!style && style !== 'none';
}

function parseBorders(root: Document): Border[] {
  const bordersEl = firstChildByLocalName(root, 'borders');
  if (!bordersEl) {
    return [];
  }
  return directChildren(bordersEl, 'border').map((border) => {
    const parsed: Border = {};
    if (sideHasBorder(border, 'left')) parsed.bl = true;
    if (sideHasBorder(border, 'right')) parsed.br = true;
    if (sideHasBorder(border, 'top')) parsed.bt = true;
    if (sideHasBorder(border, 'bottom')) parsed.bb = true;
    return parsed;
  });
}

function parseNumFmts(root: Document): Map<number, string> {
  const map = new Map<number, string>();
  for (const numFmt of childrenByLocalName(root, 'numFmt')) {
    const id = Number(numFmt.getAttribute('numFmtId'));
    const code = numFmt.getAttribute('formatCode');
    if (Number.isInteger(id) && code) {
      map.set(id, code);
    }
  }
  return map;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₩': 'KRW',
};

function decimalPlaces(code: string): number {
  const match = code.match(/\.(0+)/);
  return match ? match[1].length : 0;
}

/**
 * Detects a currency symbol used as an actual currency marker (not incidental
 * text inside a label). Currency symbols appear in a locale block
 * (`[$€-407]`), bare (`$#,##0`), or as a standalone quoted token (`"$"`) — but
 * a symbol buried inside a multi-character quoted label (`" ($ millions)"`) is
 * not currency.
 */
function detectCurrency(code: string): string | undefined {
  // Locale block: the symbol sits between `[$` and the optional `-locale`.
  const locale = code.match(/\[\$([^\]-]*)-?[^\]]*\]/);
  if (locale) {
    for (const [symbol, currency] of Object.entries(CURRENCY_SYMBOLS)) {
      if (locale[1].includes(symbol)) {
        return currency;
      }
    }
  }
  // Strip quoted labels and locale blocks so their contents cannot false-match,
  // then look for a bare symbol (or a standalone quoted token in the raw code).
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  for (const [symbol, currency] of Object.entries(CURRENCY_SYMBOLS)) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`"${escaped}"`).test(code) || stripped.includes(symbol)) {
      return currency;
    }
  }
  return undefined;
}

type NumberFormatResult = { nf: NumberFormat; cu?: string; dp?: number };

/**
 * Maps an XLSX numFmtId (+ optional custom format code) to the model's
 * `NumberFormat`. Returns undefined for the "General" / default format.
 */
export function mapNumberFormat(
  numFmtId: number,
  formatCode: string | undefined,
): NumberFormatResult | undefined {
  // Built-in ids with fixed meaning (ECMA-376 §18.8.30).
  switch (numFmtId) {
    case 0:
      return undefined; // General
    case 1:
      return { nf: 'number', dp: 0 };
    case 2:
      return { nf: 'number', dp: 2 };
    case 3:
    case 4:
      return { nf: 'number', dp: numFmtId === 4 ? 2 : 0 };
    // Built-in `$` currency formats (5/6 = 0dp, 7/8 = 2dp).
    case 5:
    case 6:
      return { nf: 'currency', cu: 'USD', dp: 0 };
    case 7:
    case 8:
      return { nf: 'currency', cu: 'USD', dp: 2 };
    case 9:
      return { nf: 'percent', dp: 0 };
    case 10:
      return { nf: 'percent', dp: 2 };
    // Built-in accounting formats (41/43 = no symbol, 42/44 = `$`).
    case 41:
      return { nf: 'number', dp: 0 };
    case 42:
      return { nf: 'currency', cu: 'USD', dp: 0 };
    case 43:
      return { nf: 'number', dp: 2 };
    case 44:
      return { nf: 'currency', cu: 'USD', dp: 2 };
    case 49:
      return { nf: 'plain' };
  }
  if (numFmtId >= 14 && numFmtId <= 22) {
    return { nf: 'date' };
  }
  if (numFmtId >= 37 && numFmtId <= 40) {
    return { nf: 'number', dp: numFmtId >= 39 ? 2 : 0 };
  }

  if (!formatCode) {
    return undefined;
  }
  const code = formatCode;
  // Percent/date/number detection runs on the code with quoted literals and
  // escaped chars removed, so text like `"USD"` is not misread as a date (the
  // `s`) or the digits/`%` inside a label.
  const unquoted = code.replace(/"[^"]*"/g, '').replace(/\\./g, '');

  const currency = detectCurrency(code);
  if (currency) {
    return { nf: 'currency', cu: currency, dp: decimalPlaces(unquoted) };
  }
  if (unquoted.includes('%')) {
    return { nf: 'percent', dp: decimalPlaces(unquoted) };
  }
  if (/[yhs]/i.test(unquoted) || /\bd{1,4}\b/i.test(unquoted)) {
    return { nf: 'date' };
  }
  if (code === '@') {
    return { nf: 'plain' };
  }
  if (/[0#]/.test(unquoted)) {
    return { nf: 'number', dp: decimalPlaces(unquoted) };
  }
  return undefined;
}

function parseAlignment(xf: Element): { al?: TextAlign; va?: VerticalAlign } {
  const alignment = firstDirectChild(xf, 'alignment');
  if (!alignment) {
    return {};
  }
  const result: { al?: TextAlign; va?: VerticalAlign } = {};
  const horizontal = alignment.getAttribute('horizontal');
  if (
    horizontal === 'left' ||
    horizontal === 'center' ||
    horizontal === 'right'
  ) {
    result.al = horizontal;
  }
  const vertical = alignment.getAttribute('vertical');
  if (vertical === 'top') {
    result.va = 'top';
  } else if (vertical === 'center') {
    result.va = 'middle';
  } else if (vertical === 'bottom') {
    result.va = 'bottom';
  }
  return result;
}

function parseCellXfs(root: Document): CellXf[] {
  const cellXfsEl = firstChildByLocalName(root, 'cellXfs');
  if (!cellXfsEl) {
    return [];
  }
  return directChildren(cellXfsEl, 'xf').map((xf) => {
    const { al, va } = parseAlignment(xf);
    return {
      fontId: Number(xf.getAttribute('fontId')) || 0,
      fillId: Number(xf.getAttribute('fillId')) || 0,
      borderId: Number(xf.getAttribute('borderId')) || 0,
      numFmtId: Number(xf.getAttribute('numFmtId')) || 0,
      al,
      va,
    };
  });
}

const EMPTY_TABLE: StyleTable = {
  resolveCellStyle: () => undefined,
};

/**
 * Parses `xl/styles.xml` into a resolvable style table. Missing or invalid
 * input yields a table that resolves every index to `undefined`.
 */
export function parseStyleTable(stylesXml: string | undefined): StyleTable {
  if (!stylesXml) {
    return EMPTY_TABLE;
  }

  const root = tryParseXml(stylesXml);
  if (!root || !firstChildByLocalName(root, 'cellXfs')) {
    return EMPTY_TABLE;
  }

  const fonts = parseFonts(root);
  const fills = parseFills(root);
  const borders = parseBorders(root);
  const numFmts = parseNumFmts(root);
  const cellXfs = parseCellXfs(root);

  // Cells overwhelmingly share a handful of `s` indices, so memoize the
  // resolved style per index instead of rebuilding it for every cell.
  const cache = new Map<number, CellStyle | undefined>();

  function computeCellStyle(s: number): CellStyle | undefined {
    const xf = cellXfs[s];
    if (!xf) {
      return undefined;
    }

    const style: CellStyle = {};

    const font = fonts[xf.fontId];
    if (font) {
      if (font.b) style.b = true;
      if (font.i) style.i = true;
      if (font.u) style.u = true;
      if (font.st) style.st = true;
      // Black is the default text color — omit to avoid styling every cell.
      if (font.color && font.color !== '#000000') {
        style.tc = font.color;
      }
    }

    const bg = fills[xf.fillId];
    if (bg) {
      style.bg = bg;
    }

    const border = borders[xf.borderId];
    if (border) {
      if (border.bl) style.bl = true;
      if (border.br) style.br = true;
      if (border.bt) style.bt = true;
      if (border.bb) style.bb = true;
    }

    if (xf.al) style.al = xf.al;
    if (xf.va) style.va = xf.va;

    const numberFormat = mapNumberFormat(xf.numFmtId, numFmts.get(xf.numFmtId));
    if (numberFormat) {
      style.nf = numberFormat.nf;
      if (numberFormat.cu !== undefined) style.cu = numberFormat.cu;
      if (numberFormat.dp !== undefined) style.dp = numberFormat.dp;
    }

    return Object.keys(style).length > 0 ? style : undefined;
  }

  function resolveCellStyle(s: number | undefined): CellStyle | undefined {
    if (s === undefined || !Number.isInteger(s)) {
      return undefined;
    }
    if (cache.has(s)) {
      return cache.get(s);
    }
    const style = computeCellStyle(s);
    cache.set(s, style);
    return style;
  }

  return { resolveCellStyle };
}
