import { describe, it, expect, afterEach } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { caretInlineStyle, caretStyleDefaults } from '../../src/model/caret-style.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createBlock } from '../../src/model/types.js';
import type { Block, Document, InlineStyle } from '../../src/model/types.js';
import { setThemeMode } from '../../src/view/theme.js';
import {
  effectiveBlockSpacing,
  omitBuiltinStyleDefaults,
  resolveStyleInline,
} from '../../src/model/named-styles.js';

/**
 * The invariant that keeps dark-mode *presentation* out of the CRDT.
 *
 * `EditorAPI.updateStyleToMatch` ("Update Heading 3 to match") captures the
 * computed style at the caret through `caretInlineStyle(doc, pos, true)` and
 * writes it into `doc.styles`, which is persisted. If that capture were
 * surface-aware, a user clicking it while in dark mode would silently redefine
 * Heading 3 to `#B0B0B0` — a color that then paints in light mode, in the PDF,
 * and for every collaborator. So these readers stay on the light surface by
 * construction (they simply never pass one), and this pins it.
 */
function docWithHeading3(): Doc {
  const h3 = createBlock('heading', { headingLevel: 3 }) as Block;
  h3.id = 'h3';
  h3.inlines = [{ text: 'Details', style: {} }];
  const document: Document = { blocks: [h3] };
  return new Doc(new MemDocStore(document));
}

describe('caret style is resolved on the light surface, whatever the theme', () => {
  afterEach(() => {
    // `setThemeMode` is a module-level global shared with the slides text-box
    // suites — a test that leaves it dark corrupts unrelated files.
    setThemeMode('light');
  });

  it('reports the document grey in dark mode', () => {
    const doc = docWithHeading3();
    setThemeMode('dark');
    expect(caretStyleDefaults(doc, { blockId: 'h3', offset: 1 }).color).toBe('#434343');
    expect(caretInlineStyle(doc, { blockId: 'h3', offset: 1 }, true).color).toBe('#434343');
  });

  it('reports the same value in light mode', () => {
    const doc = docWithHeading3();
    setThemeMode('light');
    expect(caretInlineStyle(doc, { blockId: 'h3', offset: 1 }, true).color).toBe('#434343');
  });

  it('captures the light grey, and then does not store it', () => {
    // The two halves `EditorAPI.updateStyleToMatch` runs, assembled from the
    // same reads it uses. Asserting it here rather than through a mounted
    // editor keeps the invariant covered without a canvas; the mounted case is
    // `test/view/update-style-to-match.test.ts`.
    //
    // The capture is light-surface (that is this file's subject) — but the
    // capture is also the *computed* style, so it carries `#434343` for a run
    // that never chose a color. Storing that was the shipped defect, so the
    // prune step is part of the shape and is asserted with it.
    const doc = docWithHeading3();
    setThemeMode('dark');
    const s = caretInlineStyle(doc, { blockId: 'h3', offset: 1 }, true);
    const captured = {
      inline: { fontSize: s.fontSize, color: s.color, italic: true },
      block: effectiveBlockSpacing(doc.findBlock('h3')!, doc.document.styles, { namedStyleSpacing: true }),
    };
    expect(captured.inline.color).toBe('#434343');
    expect(captured.inline.fontSize).toBe(14);

    const def = omitBuiltinStyleDefaults('heading-3', captured);
    expect(def.inline).toEqual({ italic: true });
    // `block` prunes to empty only if the captured spacing equals the
    // built-in's. It does — the capture is taken through the same docs
    // resolution the renderer uses.
    expect(def.block).toEqual({});
  });
});

/**
 * The other half of the same invariant: capturing on the light surface keeps
 * `#B0B0B0` *out* of the registry, and this keeps `#434343` out of it too.
 *
 * Both are needed. "Update to match" captures the computed style, so a run that
 * chose nothing but Bold still hands over the built-in's grey, its size and its
 * leading. The first cut stored all of them, and because `resolveStyleInline`
 * spreads a document override last and unconditionally, the frozen `#434343`
 * then outranked `inlineDark` on the dark page — 1.43:1, the inverted hierarchy
 * the dark layer exists to remove, caused by a weight change.
 */
describe('omitBuiltinStyleDefaults: only deliberate redefinitions are stored', () => {
  // What `updateStyleToMatch` hands over for a Heading 3 whose run set nothing
  // but the one property under test: the built-in's own size and grey, plus
  // whatever the user actually did.
  const capturedHeading3 = (chosen: Partial<InlineStyle>) => ({
    inline: { fontSize: 14, color: '#434343', ...chosen },
    block: { marginTop: 21, marginBottom: 5, lineHeight: 1.15 },
  });

  it('drops a color nobody chose, so the dark layer survives an Italic-then-update', () => {
    // Italic, not Bold: Heading 3's built-in *is* bold (Google Docs parity),
    // so a Bold capture is correctly pruned and would not exercise the
    // "a deliberate change survives" half of this assertion.
    const def = omitBuiltinStyleDefaults('heading-3', capturedHeading3({ italic: true }));
    expect(def.inline).toEqual({ italic: true });
    expect('color' in def.inline).toBe(false);

    const styles = { 'heading-3': def };
    expect(resolveStyleInline('heading-3', styles, 'dark').color).toBe('#B0B0B0');
    expect(resolveStyleInline('heading-3', styles, 'light').color).toBe('#434343');
    // ...and the property the user *did* change is there on both surfaces.
    expect(resolveStyleInline('heading-3', styles, 'dark').italic).toBe(true);
  });

  it('stores a color the user deliberately picked, on both surfaces', () => {
    const def = omitBuiltinStyleDefaults('heading-3', capturedHeading3({ color: '#ff0000' }));
    expect(def.inline.color).toBe('#ff0000');

    const styles = { 'heading-3': def };
    expect(resolveStyleInline('heading-3', styles, 'dark').color).toBe('#ff0000');
    expect(resolveStyleInline('heading-3', styles, 'light').color).toBe('#ff0000');
  });

  it('resolves identically to no entry at all when nothing was changed', () => {
    // The strongest statement of "the prune is observationally free on the
    // capture surface": an update-to-match that changes nothing must leave the
    // style exactly where it was, on the surface it was captured from.
    const def = omitBuiltinStyleDefaults('heading-3', capturedHeading3({}));
    expect(def.inline).toEqual({});
    expect(resolveStyleInline('heading-3', { 'heading-3': def }, 'light'))
      .toEqual(resolveStyleInline('heading-3', undefined, 'light'));
    expect(resolveStyleInline('heading-3', { 'heading-3': def }, 'dark'))
      .toEqual(resolveStyleInline('heading-3', undefined, 'dark'));
  });

  it('keeps a prior redefinition that a later unrelated update captures', () => {
    // `updateStyleDefinition` replaces the whole entry, so pruning against the
    // *effective* resolution instead of the built-in would silently revert a
    // 30 pt Heading 1 to 20 the next time anyone toggled italic and updated.
    const captured = {
      inline: { fontSize: 30, italic: true },
      block: { marginTop: 27, marginBottom: 8, lineHeight: 1.15 },
    };
    const def = omitBuiltinStyleDefaults('heading-1', captured);
    expect(def.inline).toEqual({ fontSize: 30, italic: true });
  });

  it('keeps a built-in property the user turned off', () => {
    // Heading 6 is italic by default. `false` is not the built-in's value, so
    // it is a redefinition — this is the case `editor-undo-selection.test.ts`
    // builds its undo-cost fixture on.
    const def = omitBuiltinStyleDefaults('heading-6', {
      inline: { fontSize: 11, color: '#666666', italic: false },
      block: {},
    });
    expect(def.inline).toEqual({ italic: false });
  });

  it('drops properties the capture spells out but nothing set', () => {
    const def = omitBuiltinStyleDefaults('normal', {
      inline: { bold: undefined, italic: undefined, color: undefined, fontSize: 11 },
      block: {},
    });
    // `toEqual` ignores undefined-valued keys, so this has to look at the keys
    // themselves or it passes against the raw capture too.
    expect(Object.keys(def.inline)).toEqual(['fontSize']);
  });

  it('prunes the spacing half against the built-in too', () => {
    // A paragraph that authored its leading redefines the style; one that
    // merely inherited it leaves the style tracking the catalog.
    const inherited = omitBuiltinStyleDefaults('heading-1', {
      inline: {},
      block: { marginTop: 27, marginBottom: 8, lineHeight: 1.15 },
    });
    expect(inherited.block).toEqual({});

    const authored = omitBuiltinStyleDefaults('heading-1', {
      inline: {},
      block: { marginTop: 27, marginBottom: 8, lineHeight: 2 },
    });
    expect(authored.block).toEqual({ lineHeight: 2 });
  });

  it('prunes against the surface it is told the capture came from', () => {
    // Not reachable today (the capture is light by construction), but the
    // parameter is the reason a future surface-aware capture cannot silently
    // freeze the dark grey either.
    const captured = { inline: { color: '#B0B0B0' }, block: {} };
    expect(omitBuiltinStyleDefaults('heading-3', captured, 'dark').inline).toEqual({});
    expect(omitBuiltinStyleDefaults('heading-3', captured, 'light').inline)
      .toEqual({ color: '#B0B0B0' });
  });
});
