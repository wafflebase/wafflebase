import { attr, child } from './xml';

/**
 * Pull the primary typeface from a `<a:majorFont>` / `<a:minorFont>` /
 * `<a:rPr>` container. We use the Latin face as the primary `family` —
 * our `FontScheme` and `ThemeFont` slots hold a single string and East
 * Asian / complex-script disambiguation is handled at render time by
 * the font registry (Noto Sans KR for Hangul, etc.).
 *
 * Returns `undefined` if no `<a:latin typeface>` is set. The placeholder
 * value `typeface=""` is treated as "no override" — that's how OOXML
 * exporters represent "inherit" inside `<a:minorFont>` aliases.
 */
export function parsePrimaryTypeface(container: Element): string | undefined {
  const latin = child(container, 'latin');
  if (!latin) return undefined;
  const face = attr(latin, 'typeface');
  if (!face) return undefined;
  return face.length > 0 ? face : undefined;
}

/** Returns true if any character in the string is in a Hangul block. */
export function containsHangul(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
      (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
      (code >= 0x3130 && code <= 0x318f) // Hangul Compatibility Jamo
    ) {
      return true;
    }
  }
  return false;
}
