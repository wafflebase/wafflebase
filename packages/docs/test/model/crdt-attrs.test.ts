// packages/docs/test/model/crdt-attrs.test.ts
//
// The single encoding of a block style on the Yorkie wire. Three writers emit
// it (the editor's `YorkieDocStore`, the backend's `docs-tree.ts`, the model's
// `crdt-tree.ts`) and three readers invert it, so anything this codec loses is
// lost everywhere at once.
import { describe, it, expect } from 'vitest';
import {
  AUTHORED_SPACING_ATTRS,
  AUTHORED_SPACING_FIELDS,
  serializeBlockStyleAttrs,
  parseBlockStyleAttrs,
} from '../../src/model/crdt-attrs.js';
import { DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';

describe('authored-spacing markers on the wire', () => {
  it('names one attribute per style-owned spacing field', () => {
    // Three keys, not one packed key: `Tree.styleByPath` is per-attribute LWW,
    // so two peers authoring different fields on the same paragraph must not
    // clobber each other's marker.
    expect(AUTHORED_SPACING_ATTRS).toEqual({
      marginTop: 'authoredMarginTop',
      marginBottom: 'authoredMarginBottom',
      lineHeight: 'authoredLineHeight',
    });
    expect([...AUTHORED_SPACING_FIELDS]).toEqual(Object.values(AUTHORED_SPACING_ATTRS));
  });

  it('round-trips all three states', () => {
    // true → the paragraph authored the value.
    const marked = serializeBlockStyleAttrs({ lineHeight: 1.5, authoredLineHeight: true });
    expect(marked.authoredLineHeight).toBe('1');
    expect(parseBlockStyleAttrs(marked).authoredLineHeight).toBe(true);

    // false → it authored nothing; the named style supplies it. Emitted as the
    // literal "0" rather than by omission, because `styleByPath` merges: a
    // clear that worked by omitting the attribute would need a matching
    // `removeStyleByPath` at every write site, and a writer that forgot would
    // silently resurrect the marker.
    const cleared = serializeBlockStyleAttrs({ lineHeight: 1.2, authoredLineHeight: false });
    expect(cleared.authoredLineHeight).toBe('0');
    expect(parseBlockStyleAttrs(cleared).authoredLineHeight).toBe(false);

    // absent → no information; the reader must not invent one, or every legacy
    // block would read as "authored" (or "inherited") and stop being repaired
    // by the value sentinel.
    const bare = serializeBlockStyleAttrs({ lineHeight: 1.2 });
    expect('authoredLineHeight' in bare).toBe(false);
    expect(parseBlockStyleAttrs(bare).authoredLineHeight).toBeUndefined();
  });

  it('keeps the three markers independent', () => {
    const attrs = serializeBlockStyleAttrs({
      marginTop: 0,
      authoredMarginTop: true,
      authoredMarginBottom: false,
    });
    expect(attrs).toMatchObject({
      marginTop: '0', authoredMarginTop: '1', authoredMarginBottom: '0',
    });
    expect('authoredLineHeight' in attrs).toBe(false);

    const parsed = parseBlockStyleAttrs(attrs);
    expect(parsed.authoredMarginTop).toBe(true);
    expect(parsed.authoredMarginBottom).toBe(false);
    expect(parsed.authoredLineHeight).toBeUndefined();
  });

  it('degrades a hand-edited marker to false rather than a truthy string', () => {
    // Only the writer's own "1" means authored. A CRDT edited by hand (or by an
    // older client that wrote `"true"`) must reach layout as a boolean, never
    // as a string the `??` chain in `effectiveBlockSpacing` would treat as set.
    for (const raw of ['true', '', 'yes', '2']) {
      const parsed = parseBlockStyleAttrs({ authoredLineHeight: raw });
      expect(parsed.authoredLineHeight).toBe(false);
    }
  });

  it('leaves a style with no markers byte-identical to before', () => {
    // Forward/backward compatibility: an old client's `parseBlockStyleAttrs`
    // iterates a fixed key list and simply ignores an unknown attribute, so a
    // marker written by a new peer degrades that peer to today's rendering
    // rather than corrupting anything. The inverse — a new reader on old
    // attributes — is this assertion.
    const attrs = serializeBlockStyleAttrs(DEFAULT_BLOCK_STYLE);
    expect(Object.keys(attrs).some((k) => k.startsWith('authored'))).toBe(false);
    expect(parseBlockStyleAttrs(attrs)).toEqual(DEFAULT_BLOCK_STYLE);
  });
});
