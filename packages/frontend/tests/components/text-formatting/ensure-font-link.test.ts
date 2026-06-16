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

describe('ensureFontLink', () => {
  test('injects one per-family link for a non-catalog family', () => {
    ensureFontLink('Lobster', '400');
    const links = fontLinks();
    expect(links).toHaveLength(1);
    const href = links[0].getAttribute('href') ?? '';
    expect(href.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
    expect(href).toContain(`${encodeURIComponent('Lobster')}:wght@400`);
    expect(href).toContain('&display=swap');
    expect(links[0].getAttribute('rel')).toBe('stylesheet');
    expect(links[0].dataset.wafflebaseFont).toBe('Lobster');
  });

  test('is idempotent for the same family', () => {
    ensureFontLink('Lobster');
    ensureFontLink('Lobster');
    expect(fontLinks()).toHaveLength(1);
  });

  test('different families get separate links', () => {
    ensureFontLink('Lobster');
    ensureFontLink('Pacifico');
    expect(fontLinks()).toHaveLength(2);
  });

  test('Korean family names survive idempotency (any charset)', () => {
    ensureFontLink('나눔손글씨 펜');
    ensureFontLink('나눔손글씨 펜');
    expect(fontLinks()).toHaveLength(1);
  });

  test('skips system (non-web) catalog fonts — nothing to fetch', () => {
    ensureFontLink('Arial');
    expect(fontLinks()).toHaveLength(0);
  });

  test('skips curated web fonts already in the bootstrap link', () => {
    ensureFontLink('Roboto');
    expect(fontLinks()).toHaveLength(0);
  });

  test('defaults to 400;700 weights for an unknown family', () => {
    ensureFontLink('Lobster');
    expect(fontLinks()[0].getAttribute('href')).toContain(
      `${encodeURIComponent('Lobster')}:wght@400;700`,
    );
  });
});
