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
  if (face == null) return undefined;
  // Treat whitespace-only typefaces the same as the empty string —
  // they're an "inherit" sentinel, not a real font family name.
  const trimmed = face.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

