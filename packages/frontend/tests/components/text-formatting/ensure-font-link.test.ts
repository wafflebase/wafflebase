// @vitest-environment jsdom
/**
 * Tests for the per-family lazy Google Fonts loader (`ensureFontLink`).
 *
 * The bootstrap path (`ensureGoogleFontsLink`) loads the curated menu in
 * one CSS request; `ensureFontLink` is the on-demand primitive that
 * injects a single-family `<link>` the first time a NON-curated family
 * is needed (picker hover, selection, or in-view preview in the future
 * "More fonts…" dialog).
 *
 * Asserts:
 *   - a non-catalog family injects exactly one `<link>` with the css2
 *     URL for that family and `display=swap`;
 *   - the call is idempotent per family and distinct across families;
 *   - system (non-web) catalog fonts inject nothing — there is no web
 *     font to fetch;
 *   - curated web fonts inject nothing — they are already covered by the
 *     bootstrap link, so a second per-family request would be redundant.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { ensureFontLink } from '../../../src/components/text-formatting/font-catalog.ts';

function fontLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[data-wafflebase-font]'),
  );
}

afterEach(() => {
  for (const link of fontLinks()) link.remove();
});

// Families that are deliberately NOT in the catalog, standing in for an
// arbitrary Google Font picked from the future "More fonts…" library.
const FAKE_A = 'Wafflebase Fake One';
const FAKE_B = 'Wafflebase Fake Two';
const FAKE_KR = '가짜 손글씨체';

describe('ensureFontLink', () => {
  test('injects one per-family link for an off-catalog family', () => {
    ensureFontLink(FAKE_A, '400');
    const links = fontLinks();
    expect(links).toHaveLength(1);
    const href = links[0].getAttribute('href') ?? '';
    expect(href.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
    expect(href).toContain(`${encodeURIComponent(FAKE_A)}:wght@400`);
    expect(href).toContain('&display=swap');
    expect(links[0].getAttribute('rel')).toBe('stylesheet');
    expect(links[0].dataset.wafflebaseFont).toBe(FAKE_A);
  });

  test('is idempotent for the same family', () => {
    ensureFontLink(FAKE_A);
    ensureFontLink(FAKE_A);
    expect(fontLinks()).toHaveLength(1);
  });

  test('different families get separate links', () => {
    ensureFontLink(FAKE_A);
    ensureFontLink(FAKE_B);
    expect(fontLinks()).toHaveLength(2);
  });

  test('Korean family names survive idempotency (any charset)', () => {
    ensureFontLink(FAKE_KR);
    ensureFontLink(FAKE_KR);
    expect(fontLinks()).toHaveLength(1);
  });

  test('lazily loads a catalog web font that is not eager', () => {
    // Lobster is in the catalog (Display) but not eager — it must load
    // on demand rather than being skipped as already-bootstrapped.
    ensureFontLink('Lobster');
    const links = fontLinks();
    expect(links).toHaveLength(1);
    // Uses the catalog's real weight spec (Lobster ships a single 400).
    expect(links[0].getAttribute('href')).toContain(
      `${encodeURIComponent('Lobster')}:wght@400&`,
    );
  });

  test('skips system (non-web) catalog fonts — nothing to fetch', () => {
    ensureFontLink('Arial');
    expect(fontLinks()).toHaveLength(0);
  });

  test('skips eager web fonts already in the bootstrap link', () => {
    ensureFontLink('Roboto');
    expect(fontLinks()).toHaveLength(0);
  });

  test('defaults to 400;700 weights for an unknown family', () => {
    ensureFontLink(FAKE_A);
    expect(fontLinks()[0].getAttribute('href')).toContain(
      `${encodeURIComponent(FAKE_A)}:wght@400;700`,
    );
  });
});
