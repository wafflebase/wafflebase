/**
 * Tests for the shared font catalog and the Google Fonts URL builder.
 *
 * Asserts:
 *   - every Korean catalog entry that loads from Google Fonts is encoded
 *     into the link href so DOM/Canvas paint can resolve the family;
 *   - per-entry `weights` overrides reach the URL — display fonts that
 *     only ship `wght@400` must not request `400;700` (Google Fonts
 *     returns an error CSS payload when a missing weight is requested,
 *     and a single bad family poisons the whole link).
 */
import { describe, test, expect } from 'vitest';
import {
  FONT_CATALOG,
  buildGoogleFontsHref,
} from '../../../src/components/text-formatting/font-catalog.ts';

describe('font-catalog', () => {
  test('Google Fonts href encodes every webFont entry', () => {
    const href = buildGoogleFontsHref();
    expect(href.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
    for (const entry of FONT_CATALOG) {
      if (!entry.webFont) continue;
      // The family name must appear URL-encoded somewhere in the link.
      expect(href).toContain(encodeURIComponent(entry.family));
    }
  });

  test('entry weights override the default 400;700 spec', () => {
    const href = buildGoogleFontsHref();
    // Gowun Dodum ships only Regular on Google Fonts. The default
    // 400;700 spec would 400 the entire CSS response.
    expect(href).toContain(`${encodeURIComponent('Gowun Dodum')}:wght@400&`);
    expect(href).not.toContain(`${encodeURIComponent('Gowun Dodum')}:wght@400;700`);
  });

  test('default weights are 400;700 when entry has no override', () => {
    const href = buildGoogleFontsHref();
    // Noto Sans KR is a multi-weight catalog regular — no override.
    expect(href).toContain(`${encodeURIComponent('Noto Sans KR')}:wght@400;700`);
  });

  test('href ends with display=swap to avoid FOIT during font load', () => {
    expect(buildGoogleFontsHref()).toContain('&display=swap');
  });
});
