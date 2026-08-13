import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createModuleClassifier,
  fileOf,
  frameOf,
  stripFrameQuery,
  withFrameQuery,
} from '../../src/plugin/frame';
import { layoutFileOf, planFiles } from '../../src/plugin/protocol';

/**
 * The frame query is how one dev server holds two versions of one module. These
 * are pure string and path functions, and they are unit-tested for the same
 * reason `paths.ts` is: `isFirstParty` decides what the plugin may rewrite, and
 * the query round-trip is what keeps a patched module from being served
 * unpatched — neither failure is visible in a smoke script's screenshots.
 */

const ROOT = path.resolve('/proj');
const abs = (p: string) => path.join(ROOT, p);

describe('the frame query round-trip', () => {
  it('reads back the side it wrote, with and without an existing query', () => {
    for (const id of [abs('src/a.tsx'), `${abs('src/a.tsx')}?import`]) {
      for (const side of ['before', 'after'] as const) {
        expect(frameOf(withFrameQuery(id, side)), `${id} ${side}`).toBe(side);
      }
    }
  });

  it('strips back to exactly the original id', () => {
    // The property that matters: qualify then strip is an identity. If it were
    // not, the stripped id would miss the module graph and the frame would serve
    // unpatched source while reporting the plan as applied.
    for (const id of [abs('src/a.tsx'), `${abs('src/a.tsx')}?import`, `${abs('a.tsx')}?t=123&import`]) {
      expect(stripFrameQuery(withFrameQuery(id, 'before')), id).toBe(id);
    }
  });

  it('keeps every OTHER query param BYTE-IDENTICAL when stripping', () => {
    // Vite's own `?import`, `?raw`, `?url` and `?t=` cache-busting ride on these
    // ids. Dropping them changes what the id means, not just its frame.
    expect(stripFrameQuery(`${abs('a.tsx')}?wbFrame=after&import`)).toBe(`${abs('a.tsx')}?import`);
    expect(stripFrameQuery(`${abs('a.tsx')}?t=9&wbFrame=after`)).toBe(`${abs('a.tsx')}?t=9`);
  });

  it('does not append "=" to a VALUELESS Vite flag', () => {
    // The prototype built the surviving query with `URLSearchParams`, whose
    // round-trip is lossy for precisely these: `new URLSearchParams('import')
    // .toString()` is `'import='`. Vite matches its flags by pattern on the raw
    // id, so the extra byte un-sets the flag — measured, `/(\?|&)import(&|$)/`
    // matches `?import` and does NOT match `?import=`. The stripped module would
    // then be served down a different path from the one the importer asked for.
    for (const flag of ['import', 'raw', 'url', 'worker']) {
      expect(stripFrameQuery(`${abs('a.tsx')}?${flag}&wbFrame=after`), flag)
        .toBe(`${abs('a.tsx')}?${flag}`);
      expect(stripFrameQuery(`${abs('a.tsx')}?wbFrame=after&${flag}`), flag)
        .toBe(`${abs('a.tsx')}?${flag}`);
    }
  });

  it('drops a valueless wbFrame too, not only the `wbFrame=side` form', () => {
    // `frameOf` reads it as null either way, so a bare `?wbFrame` is not a side —
    // but leaving it behind would make the stripped id differ from the original.
    expect(stripFrameQuery(`${abs('a.tsx')}?wbFrame`)).toBe(abs('a.tsx'));
    expect(stripFrameQuery(`${abs('a.tsx')}?wbFrame&import`)).toBe(`${abs('a.tsx')}?import`);
  });

  it('is null for an unqualified id and for a foreign query value', () => {
    expect(frameOf(abs('a.tsx'))).toBeNull();
    expect(frameOf(`${abs('a.tsx')}?import`)).toBeNull();
    expect(frameOf(`${abs('a.tsx')}?wbFrame=sideways`)).toBeNull();
    expect(frameOf(null)).toBeNull();
    expect(frameOf(undefined)).toBeNull();
    expect(frameOf('')).toBeNull();
  });

  it('leaves an id with no query untouched when stripping', () => {
    expect(stripFrameQuery(abs('a.tsx'))).toBe(abs('a.tsx'));
  });

  it('fileOf drops the frame query and every other query', () => {
    expect(fileOf(`${abs('a.tsx')}?wbFrame=before&import`)).toBe(abs('a.tsx'));
  });
});

describe('isFirstParty', () => {
  const c = createModuleClassifier(ROOT);

  it('accepts the consumer own JS/TS source', () => {
    for (const f of ['src/a.tsx', 'src/a.ts', 'src/a.jsx', 'src/a.js', 'src/a.mjs']) {
      expect(c.isFirstParty(abs(f)), f).toBe(true);
    }
  });

  it('accepts an id that is already frame-qualified', () => {
    // `resolveId` sees ids mid-propagation, so this is the common case, not a
    // corner: rejecting them would stop the qualification spreading past the
    // first module.
    expect(c.isFirstParty(`${abs('src/a.tsx')}?wbFrame=after`)).toBe(true);
  });

  it('refuses virtual ids, which have no file to read', () => {
    expect(c.isFirstParty('\0virtual:wb-scenes')).toBe(false);
    expect(c.isFirstParty('virtual:wb-scenes')).toBe(false);
  });

  it('refuses an unresolved relative id', () => {
    // Qualifying one yields an id that resolves differently per importer.
    expect(c.isFirstParty('./a.tsx')).toBe(false);
    expect(c.isFirstParty('react')).toBe(false);
  });

  it('refuses node_modules at any depth', () => {
    expect(c.isFirstParty(abs('node_modules/react/index.js'))).toBe(false);
    expect(c.isFirstParty(abs('packages/ui/node_modules/x/a.js'))).toBe(false);
  });

  it('refuses anything outside the root', () => {
    expect(c.isFirstParty(path.resolve('/elsewhere/a.tsx'))).toBe(false);
  });

  it('refuses non-module extensions, so a stylesheet keeps its own pipeline', () => {
    // Appending an unknown query to a `.css` id routes it away from the pipeline
    // that handles it, and the frame renders unstyled.
    for (const f of ['src/a.css', 'src/a.json', 'src/a.svg', 'src/a.png']) {
      expect(c.isFirstParty(abs(f)), f).toBe(false);
    }
  });

  it('refuses configured opaque roots, which are ours but not JSX', () => {
    const withOpaque = createModuleClassifier(ROOT, (p) => p.startsWith(abs('packages/sheets/src')));
    expect(withOpaque.isFirstParty(abs('packages/sheets/src/deep/a.ts'))).toBe(false);
    expect(withOpaque.isFirstParty(abs('src/a.tsx'))).toBe(true);
  });
});

describe('isStampable', () => {
  const c = createModuleClassifier(ROOT);

  it('is JSX extensions only, narrower than isFirstParty', () => {
    expect(c.isStampable(abs('src/a.tsx'))).toBe(true);
    expect(c.isStampable(abs('src/a.jsx'))).toBe(true);
    // First-party, but no JSX element can appear in it, so stamping it is work
    // with no output.
    expect(c.isFirstParty(abs('src/a.ts'))).toBe(true);
    expect(c.isStampable(abs('src/a.ts'))).toBe(false);
    expect(c.isStampable(abs('src/a.mjs'))).toBe(false);
  });

  it('sees through a frame query to the real extension', () => {
    expect(c.isStampable(`${abs('src/a.tsx')}?wbFrame=before`)).toBe(true);
  });
});

describe('layoutFileOf / planFiles', () => {
  const anchor = (file: string) => ({ file, component: 'C', path: [0], tag: 'div', fp: 'aaaaaaaa' });

  it('reads the file off the ANCHOR, not off intent.file', () => {
    // `file` is the token kinds' field. Reading it here would target nothing for
    // every layout intent, and `planFiles` would report an empty set — so a frame
    // would serve unpatched source while claiming the plan was applied.
    expect(
      layoutFileOf({ kind: 'layout-props', file: 'wrong.tsx', anchor: anchor('right.tsx') }),
    ).toBe('right.tsx');
  });

  it('falls back to the parent anchor, which is what an insert carries', () => {
    expect(layoutFileOf({ kind: 'layout-insert', parent: anchor('p.tsx') })).toBe('p.tsx');
  });

  it('is null for a non-layout kind, even when an anchor is present', () => {
    expect(layoutFileOf({ kind: 'token-value', anchor: anchor('a.tsx') })).toBeNull();
    expect(layoutFileOf({ anchor: anchor('a.tsx') })).toBeNull();
  });

  it('de-duplicates the file set a plan touches', () => {
    expect([
      ...planFiles([
        { kind: 'layout-props', anchor: anchor('a.tsx') },
        { kind: 'layout-remove', anchor: anchor('a.tsx') },
        { kind: 'layout-insert', parent: anchor('b.tsx') },
        { kind: 'token-value', file: 'tokens.ts' },
      ]),
    ]).toEqual(['a.tsx', 'b.tsx']);
  });
});
