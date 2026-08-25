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
import {
  ensureFontLink,
  ensurePreviewFontLink,
} from '../../../src/components/text-formatting/font-catalog.ts';

function fontLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[data-wafflebase-font]'),
  );
}

function previewLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      'link[data-wafflebase-font-preview]',
    ),
  );
}

afterEach(() => {
  for (const link of [...fontLinks(), ...previewLinks()]) link.remove();
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

/**
 * `ensurePreviewFontLink` is the cheap counterpart used by the two
 * per-row visibility observers (picker dropdown + "More fonts…" dialog):
 * painting a label needs that label's glyphs, not the family's whole
 * character set.
 */
describe('ensurePreviewFontLink', () => {
  test('requests only the row text, under the preview marker', () => {
    ensurePreviewFontLink(FAKE_A, 'Wafflebase Fake One');
    expect(fontLinks()).toHaveLength(0); // invisible to the full-load path
    const links = previewLinks();
    expect(links).toHaveLength(1);
    const href = links[0].getAttribute('href') ?? '';
    expect(href.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
    // Each glyph once, in first-appearance order.
    expect(href).toContain(`text=${encodeURIComponent('Waflebs FkOn')}`);
    expect(href).toContain('&display=swap');
    expect(links[0].getAttribute('rel')).toBe('stylesheet');
    expect(links[0].dataset.wafflebaseFontPreview).toBe(FAKE_A);
    // The subset marker must NOT collide with the full-load one, which is
    // what makes the dedupe in `ensureFontLink` blind to it.
    expect(links[0].hasAttribute('data-wafflebase-font')).toBe(false);
  });

  test('is idempotent per family and distinct across families', () => {
    ensurePreviewFontLink(FAKE_A, 'One');
    ensurePreviewFontLink(FAKE_A, 'One');
    ensurePreviewFontLink(FAKE_B, 'Two');
    expect(previewLinks()).toHaveLength(2);
  });

  // The regression this whole split exists for: a family the user only
  // ever scrolled past must still load completely when they pick it,
  // otherwise the applied text renders with the label's glyphs only.
  test('a previewed family still loads in full when selected', () => {
    ensurePreviewFontLink(FAKE_A, 'Wafflebase Fake One');
    ensureFontLink(FAKE_A);
    const full = fontLinks();
    expect(full).toHaveLength(1);
    expect(full[0].dataset.wafflebaseFont).toBe(FAKE_A);
    expect(full[0].getAttribute('href')).not.toContain('text=');
    // Declared after the subset, so it wins the cascade for every glyph.
    expect(
      previewLinks()[0].compareDocumentPosition(full[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Hover-prefetching a row and then scrolling it back into view must not
  // append a subset link: being later in the head it would win the
  // cascade and shrink a face that already had every glyph.
  test('no-ops once a full link for the family exists', () => {
    ensureFontLink(FAKE_A);
    ensurePreviewFontLink(FAKE_A, 'Wafflebase Fake One');
    expect(previewLinks()).toHaveLength(0);
  });

  // `Sunflower` (해바라기) ships a single 700 cut; css2 answers a request
  // for :wght@400 with an HTTP 400 HTML error page, which would leave the
  // row in a fallback face forever.
  test('asks for a weight the family actually ships', () => {
    ensurePreviewFontLink('Sunflower', '해바라기', '700');
    const href = previewLinks()[0].getAttribute('href') ?? '';
    expect(href).toContain(`${encodeURIComponent('Sunflower')}:wght@700&`);
    expect(href).not.toContain('wght@400');
  });

  // Same family, but with the caller unable to supply `weights` (a recent
  // row whose entry is missing): the catalog still knows the answer.
  test('falls back to the catalog weight when none is passed', () => {
    ensurePreviewFontLink('Sunflower', '해바라기');
    expect(previewLinks()[0].getAttribute('href')).toContain(
      `${encodeURIComponent('Sunflower')}:wght@700&`,
    );
  });

  test('requests a single cut of a multi-weight family', () => {
    ensurePreviewFontLink(FAKE_A, 'One', '300;400;700');
    expect(previewLinks()[0].getAttribute('href')).toContain(
      `${encodeURIComponent(FAKE_A)}:wght@300&`,
    );
  });

  test('skips system fonts, eager fonts, and empty rows', () => {
    ensurePreviewFontLink('Arial', 'Arial');
    ensurePreviewFontLink('Roboto', 'Roboto');
    ensurePreviewFontLink(FAKE_A, '');
    expect(previewLinks()).toHaveLength(0);
    expect(fontLinks()).toHaveLength(0);
  });

  test('lazily previews a catalog web font that is not eager', () => {
    ensurePreviewFontLink('Lobster', 'Lobster');
    const href = previewLinks()[0].getAttribute('href') ?? '';
    expect(href).toContain(`${encodeURIComponent('Lobster')}:wght@400&`);
    expect(href).toContain(`text=${encodeURIComponent('Lobster')}`);
  });

  test('Korean family names and glyphs survive idempotency', () => {
    ensurePreviewFontLink(FAKE_KR, '가짜 손글씨체');
    ensurePreviewFontLink(FAKE_KR, '가짜 손글씨체');
    expect(previewLinks()).toHaveLength(1);
    expect(previewLinks()[0].getAttribute('href')).toContain(
      `text=${encodeURIComponent('가짜 손글씨체')}`,
    );
  });
});
