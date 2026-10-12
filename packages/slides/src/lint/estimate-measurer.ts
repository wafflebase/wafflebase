import type { ResolvedFont, TextMeasurer } from '@wafflebase/docs';

/**
 * A font-free width estimate for Node, where there is no Canvas to ask.
 *
 * Per-character widths in em, calibrated against Chromium's canvas
 * `measureText` for Arial/Helvetica and the common sans fallbacks (Inter,
 * Roboto, Noto Sans KR): lowercase Latin averages 0.44–0.49 em, capitals
 * 0.67–0.68, digits 0.50–0.56, a space 0.25–0.28, and Hangul 0.87 (Apple
 * SD Gothic behind Arial) to 1.06 (the headless default sans). Latin
 * classes take the top of their range and wide characters 0.95, so the
 * estimate errs toward one line too many (reporting an overflow that is
 * not there) rather than one too few. Bold adds 5%.
 *
 * This is the caveat the layout report carries: line breaks can differ
 * from the browser's, most for narrow or unusual fonts. Pass a real
 * measurer (fontkit with the deck's fonts, or Canvas) when exact.
 */
export function estimateMeasurer(): TextMeasurer {
  return {
    measureWidth(text: string, font: ResolvedFont): number {
      let ems = 0;
      for (const ch of text) ems += charEm(ch);
      const bold = font.weight === 'bold';
      const spacing = (font.letterSpacing ?? 0) * [...text].length;
      return ems * font.size * (bold ? 1.05 : 1) + spacing;
    },
  };
}

function charEm(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (isWide(cp)) return 0.95;
  if (ch === ' ') return 0.28;
  if (ch >= 'a' && ch <= 'z') return 0.5;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (/[.,:;'!|ilI()[\]]/.test(ch)) return 0.3;
  return 0.6;
}
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // Full-width forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK extension B+
  );
}
