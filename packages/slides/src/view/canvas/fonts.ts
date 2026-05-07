import { resolveFontFamily } from '@wafflebase/docs';

/**
 * Slides text-box default font. Slides defaults to Inter so it matches
 * the rest of the Wafflebase frontend chrome; docs defaults to Arial
 * for Word-document parity. Either choice is fine — what matters is
 * that the value here stays in sync with the default in
 * `text-renderer.ts:resolveCtxFont`.
 */
const SLIDES_DEFAULT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * Resolve a slides text-box font family to a CSS font-family chain.
 *
 * Slides shares the docs font registry (`packages/docs/src/view/fonts.ts`),
 * so a Korean font name like `'맑은 고딕'` resolves to the same Noto Sans
 * KR fallback chain the docs editor would use. Latin font names that
 * docs doesn't map are returned unchanged with a generic-family
 * fallback appended.
 *
 * Why this exists, given that Canvas already does last-resort glyph
 * fallback to OS fonts: when the user explicitly picks a Korean family
 * that isn't installed (e.g. `'맑은 고딕'` on macOS), Canvas can't fall
 * back to that family at all and ends up rendering everything in its
 * default sans-serif — which on some systems lacks Korean glyphs and
 * shows tofu boxes. Threading the family through `resolveFontFamily`
 * gives Canvas an explicit `'Noto Sans KR'` step in the chain so CJK
 * glyphs find a font even when the requested face is missing.
 *
 * No font is fetched here. Loading is the responsibility of whatever
 * page hosts the slides editor (frontend `index.html` ships Inter +
 * relies on browser fallback for CJK; Phase 5b PDF export does its own
 * `document.fonts.load('Noto Sans KR')` like the docs PDF exporter).
 */
export function resolveSlideFontFamily(family?: string): string {
  if (!family) return SLIDES_DEFAULT_FAMILY;
  return resolveFontFamily(family);
}
