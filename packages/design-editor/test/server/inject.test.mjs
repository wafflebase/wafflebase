import { describe, expect, it } from 'vitest';
import {
  applyLayoutInsert,
  applyLayoutProps,
  applyLayoutRemove,
  insertImport,
  removeImport,
  unifiedDiff,
} from '../../src/server/inject.mjs';
import { findJsxRoots, parse, walkJsx } from '../../src/server/jsx-nodes.mjs';

/**
 * `inject.mjs` is the first module here that WRITES. `jsx-nodes`, `extract` and
 * `stamp` only read, so their worst failure shows the designer something wrong;
 * this one edits a file in someone's working tree.
 *
 * The property that matters most is the INVOLUTION: `applyLayoutRemove` reports
 * the exact span it cut, and re-inserting that span with `verbatim: true` must
 * restore the file byte-for-byte. It holds because both ops derive their offset
 * from one function (`childSpliceOffset`) — two copies of that arithmetic would
 * let byte-identity break silently. The `remove → insert` describe asserts it
 * over every shape, not just the easy one.
 */

// --- helpers ---------------------------------------------------------------

/** A real `NodeAnchor` for the first `tag` in `src`, built the way a client would. */
function anchorFor(src, tag, component = 'C') {
  const sf = parse(src, 'scene.tsx');
  const root = findJsxRoots(sf).roots[component];
  if (!root) throw new Error(`no root named ${component}`);
  const e = [...walkJsx(sf, root)].find((x) => x.tag === tag);
  if (!e) throw new Error(`no <${tag}> in ${component}`);
  return { component, path: e.path, tag: e.tag, fp: e.fp, fpx: e.fpx };
}

const SCENE = `function C() {
  return (
    <div className="wrap gap-2">
      <Alpha id="a" />
      <Beta id="b" />
      <Gamma id="c" />
    </div>
  );
}
`;

// --- applyLayoutProps ------------------------------------------------------

describe('applyLayoutProps', () => {
  it('adds an attribute after the tag name, before existing ones', () => {
    const r = applyLayoutProps(SCENE, {
      anchor: anchorFor(SCENE, 'Alpha'),
      sets: [{ name: 'title', value: 'Hi' }],
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('<Alpha title="Hi" id="a" />');
  });

  it('replaces an existing attribute in place', () => {
    const r = applyLayoutProps(SCENE, {
      anchor: anchorFor(SCENE, 'Alpha'),
      sets: [{ name: 'id', value: 'z' }],
    });
    expect(r.text).toContain('<Alpha id="z" />');
  });

  it('removes an attribute and exactly one adjacent space', () => {
    const r = applyLayoutProps(SCENE, {
      anchor: anchorFor(SCENE, 'Alpha'),
      sets: [{ name: 'id', value: null }],
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('<Alpha />');
  });

  it('escapes a value containing a double quote instead of breaking the attribute', () => {
    const r = applyLayoutProps(SCENE, {
      anchor: anchorFor(SCENE, 'Alpha'),
      sets: [{ name: 'title', value: 'say "hi"' }],
    });
    expect(r.text).toContain('title={"say \\"hi\\""}');
    // And the result must still parse — a broken attribute would be a corrupt file.
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
  });

  it('REFUSES an expression value that is not a bare reference or literal', () => {
    // The value arrives from a browser and is spliced into a file the dev server
    // executes on the next reload. An unguarded expression here is remote code
    // execution, so anything but a dotted reference or a number/boolean is
    // rejected rather than escaped.
    for (const value of ['fetch("/x")', 'a && b', '(() => {})()', 'x; drop()']) {
      const r = applyLayoutProps(SCENE, {
        anchor: anchorFor(SCENE, 'Alpha'),
        sets: [{ name: 'onClick', value, valueKind: 'expression' }],
      });
      expect(r.located, `must refuse ${value}`).toBe(false);
      expect(r.reason).toMatch(/only string literals and bare references/);
    }
  });

  it('accepts a dotted reference and a numeric literal as expressions', () => {
    const r = applyLayoutProps(SCENE, {
      anchor: anchorFor(SCENE, 'Alpha'),
      sets: [
        { name: 'onClick', value: 'handlers.save', valueKind: 'expression' },
        { name: 'count', value: '3', valueKind: 'expression' },
      ],
    });
    expect(r.text).toContain('onClick={handlers.save}');
    expect(r.text).toContain('count={3}');
  });

  it('rewrites class tokens on whole-token boundaries only', () => {
    // `wrap` must not match inside `wrapper`, which a substring replace would.
    const src = `function C() { return <div className="wrapper wrap gap-2"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { removals: ['wrap'] },
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('className="wrapper gap-2"');
  });

  it('creates a className attribute when the node has none', () => {
    const src = `function C() { return <div><Row/></div>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'Row'),
      classOps: { additions: ['p-2'] },
    });
    expect(r.text).toContain('<Row className="p-2"/>');
  });

  it('REFUSES a className that is not a plain string literal', () => {
    // `classLiteralOf` only reports a literal it is safe to rewrite. Since it was
    // narrowed to a joiner allowlist, this also covers `className={t("nav.home")}`
    // — which an earlier version would have overwritten, destroying the key.
    // Refusing is correct; making it VISIBLE to the designer is the follow-up.
    const src = `function C() { return <div className={t("nav.home")}/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { additions: ['p-2'] },
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/not a string literal/);
    expect(r.text).toBe(src);
  });

  it('replaces a single text run, preserving its surrounding whitespace', () => {
    const src = `function C() {\n  return (\n    <p>\n      hello\n    </p>\n  );\n}\n`;
    const r = applyLayoutProps(src, { anchor: anchorFor(src, 'p'), text: 'goodbye' });
    expect(r.located).toBe(true);
    expect(r.text).toContain('\n      goodbye\n    </p>');
  });

  it('applies props inside a .map() body — the one op allowed there', () => {
    const src = `function C() { return <ul>{items.map(d => <li id="r"/>)}</ul>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'li'),
      sets: [{ name: 'title', value: 'row' }],
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('title="row"');
  });

  it('writes nothing and reports why when no operation applies', () => {
    // Targets the <div>, which HAS a className — `<Alpha>` has none, and would
    // take the "create a fresh attribute" branch instead.
    const r = applyLayoutProps(SCENE, {
      anchor: anchorFor(SCENE, 'div'),
      classOps: { removals: ['nope'] },
    });
    expect(r.located).toBe(false);
    expect(r.text).toBe(SCENE);
    expect(r.reason).toMatch(/no matching classes/);
  });

  it('reports the no-className case distinctly from the no-match case', () => {
    const r = applyLayoutProps(SCENE, {
      anchor: anchorFor(SCENE, 'Alpha'),
      classOps: { removals: ['nope'] },
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/no className attribute/);
  });

  it('applies several splices highest-offset-first so earlier offsets stay valid', () => {
    const r = applyLayoutProps(SCENE, {
      anchor: anchorFor(SCENE, 'div'),
      sets: [{ name: 'id', value: 'root' }],
      classOps: { additions: ['p-4'] },
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('id="root"');
    expect(r.text).toContain('className="wrap gap-2 p-4"');
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
  });
});

// --- applyLayoutInsert -----------------------------------------------------

describe('applyLayoutInsert', () => {
  it('inserts into the component root — the commonest structural op', () => {
    const r = applyLayoutInsert(SCENE, {
      parent: anchorFor(SCENE, 'div'),
      index: 0,
      raw: '<New />',
    });
    expect(r.located).toBe(true);
    expect(r.text).toMatch(/<div className="wrap gap-2">\n\s+<New \/>\n\s+<Alpha/);
  });

  it('indents a fresh snippet to the insertion site', () => {
    const r = applyLayoutInsert(SCENE, {
      parent: anchorFor(SCENE, 'div'),
      index: 1,
      raw: '<New />',
    });
    // Same indent as the sibling it follows.
    expect(r.text).toContain('      <Alpha id="a" />\n      <New />');
  });

  it('preserves a multi-line snippet’s own relative indentation', () => {
    const r = applyLayoutInsert(SCENE, {
      parent: anchorFor(SCENE, 'div'),
      index: 0,
      raw: '<Wrap>\n  <Inner />\n</Wrap>',
    });
    expect(r.text).toContain('      <Wrap>\n        <Inner />\n      </Wrap>');
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
  });

  it('appends at index === children.length', () => {
    const r = applyLayoutInsert(SCENE, {
      parent: anchorFor(SCENE, 'div'),
      index: 3,
      raw: '<New />',
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('<Gamma id="c" />\n      <New />');
  });

  it('refuses an out-of-range index rather than clamping it', () => {
    for (const index of [-1, 4]) {
      const r = applyLayoutInsert(SCENE, { parent: anchorFor(SCENE, 'div'), index, raw: '<X/>' });
      expect(r.located).toBe(false);
      expect(r.reason).toMatch(/out of range/);
      expect(r.text).toBe(SCENE);
    }
  });

  it('refuses a self-closing parent instead of reshaping it', () => {
    // Turning `<X/>` into `<X></X>` would make the inverse non-byte-identical.
    const src = `function C() { return <div><Leaf/></div>; }`;
    const r = applyLayoutInsert(src, { parent: anchorFor(src, 'Leaf'), index: 0, raw: '<X/>' });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/self-closing/);
  });

  it('refuses a parent inside a .map() body', () => {
    // The scope guard survives `role: 'container'`: the container renders N
    // times, so "insert one child" is not a well-defined edit.
    const src = `function C() { return <ul>{items.map(d => <li/>)}</ul>; }`;
    const r = applyLayoutInsert(src, { parent: anchorFor(src, 'li'), index: 0, raw: '<X/>' });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/iteration scope/);
  });
});

// --- the involution --------------------------------------------------------

describe('remove → insert is byte-identical', () => {
  // The property the undo path rests on. `removedText` is the analogue of a
  // token edit's `oldValue`: the client stores it and replays it verbatim.
  // Both ops take their offset from `childSpliceOffset`, which is what makes
  // this exact rather than approximate.
  const CASES = {
    'first child': [SCENE, 'Alpha', 'div'],
    'middle child': [SCENE, 'Beta', 'div'],
    'last child': [SCENE, 'Gamma', 'div'],
    'single child': [`function C() {\n  return (\n    <div>\n      <Only />\n    </div>\n  );\n}\n`, 'Only', 'div'],
    'nested child': [`function C() {\n  return (\n    <div>\n      <Row>\n        <Cell />\n      </Row>\n    </div>\n  );\n}\n`, 'Cell', 'Row'],
    'one-line body': [`function C() { return <div><A/><B/></div>; }`, 'B', 'div'],
  };

  for (const [name, [src, tag, parentTag]] of Object.entries(CASES)) {
    it(`restores the file exactly: ${name}`, () => {
      const rm = applyLayoutRemove(src, { anchor: anchorFor(src, tag) });
      expect(rm.located, rm.reason).toBe(true);
      expect(rm.text).not.toBe(src);

      const back = applyLayoutInsert(rm.text, {
        parent: anchorFor(src, parentTag),
        index: rm.removedIndex,
        raw: rm.removedText,
        verbatim: true,
      });
      expect(back.located, back.reason).toBe(true);
      expect(back.text).toBe(src);
    });
  }

  it('captures the leading newline and indent, not just the element', () => {
    // That whitespace is what makes the replay a pure span splice. Capturing
    // only `<Beta id="b" />` would restore the element on the wrong line.
    const rm = applyLayoutRemove(SCENE, { anchor: anchorFor(SCENE, 'Beta') });
    expect(rm.removedText).toBe('\n      <Beta id="b" />');
    expect(rm.removedIndex).toBe(1);
    expect(rm.parentPath).toEqual([0]);
  });
});

// --- applyLayoutRemove -----------------------------------------------------

describe('applyLayoutRemove', () => {
  it('refuses a whole returned element — there is no sibling list to leave', () => {
    const r = applyLayoutRemove(SCENE, { anchor: anchorFor(SCENE, 'div') });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/whole return value/);
    expect(r.text).toBe(SCENE);
  });

  it('refuses a node inside a .map() body', () => {
    const src = `function C() { return <ul>{items.map(d => <li/>)}</ul>; }`;
    const r = applyLayoutRemove(src, { anchor: anchorFor(src, 'li') });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/iteration scope/);
  });

  it('refuses a child of a RETURNED FRAGMENT, whose container has no anchor', () => {
    // Discovered while writing the involution table above: the remove succeeded
    // and the verbatim re-insert was refused, because a returned fragment is
    // transparent so `<B/>`'s parent is the synthetic returns root — which no
    // anchor can name. Same "gone with no way back" shape `role: 'container'`
    // fixes one layer up, so it gets the same answer: refuse the destructive
    // half rather than let it outrun its inverse.
    const src = `function C() {\n  return (\n    <>\n      <A />\n      <B />\n    </>\n  );\n}\n`;
    const r = applyLayoutRemove(src, { anchor: anchorFor(src, 'B') });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/container has no anchor/);
    expect(r.text).toBe(src);
  });

  it('still allows PROPS on a returned fragment’s child', () => {
    // The refusal is scoped to the destructive op — an attribute edit has no
    // inverse problem, so it must stay available.
    const src = `function C() { return <><A id="a"/><B/></>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'A'),
      sets: [{ name: 'title', value: 'x' }],
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('title="x"');
  });

  it('refuses a conditionally-rendered node — removing it would leave a bare {}', () => {
    const src = `function C() { return <div>{cond && <b/>}</div>; }`;
    const r = applyLayoutRemove(src, { anchor: anchorFor(src, 'b') });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/conditionally-rendered/);
  });

  it('leaves a parseable file behind', () => {
    const r = applyLayoutRemove(SCENE, { anchor: anchorFor(SCENE, 'Beta') });
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
    expect(r.text).not.toContain('Beta');
  });
});

// --- imports ---------------------------------------------------------------

describe('insertImport', () => {
  it('merges into an existing named group', () => {
    const src = `import { A } from './m';\n\nconst x = 1;\n`;
    const r = insertImport(src, { module: './m', named: ['B'] });
    expect(r.text).toContain(`import { A, B } from './m';`);
  });

  it('is a no-op when already present', () => {
    const src = `import { A } from './m';\n`;
    const r = insertImport(src, { module: './m', named: ['A'] });
    expect(r.located).toBe(false);
    expect(r.reason).toBe('already imported');
    expect(r.text).toBe(src);
  });

  it('adds a named group beside a default-only import', () => {
    const src = `import React from 'react';\n`;
    const r = insertImport(src, { module: 'react', named: ['useState'] });
    expect(r.text).toContain(`import React, { useState } from 'react';`);
  });

  it('adds a new statement after the last existing import', () => {
    const src = `import { A } from './a';\nimport { B } from './b';\n\nconst x = 1;\n`;
    const r = insertImport(src, { module: './c', named: ['C'] });
    expect(r.text).toContain(`import { B } from './b';\nimport { C } from './c';`);
  });

  it('adds the first import at the top of a file that has none', () => {
    const r = insertImport(`const x = 1;\n`, { module: './c', named: ['C'] });
    expect(r.text).toBe(`import { C } from './c';\nconst x = 1;\n`);
  });

  it('refuses a namespace import rather than reshaping it', () => {
    const src = `import * as M from './m';\n`;
    const r = insertImport(src, { module: './m', named: ['B'] });
    expect(r.located).toBe(false);
    expect(r.reason).toBe('unsupported import form');
    expect(r.text).toBe(src);
  });
});

describe('removeImport', () => {
  it('keeps a specifier that is still referenced', () => {
    // Not politeness: a stray unused import is harmless, a MISSING one breaks
    // the build. A remove that deleted one of two usages would do exactly that.
    const src = `import { A } from './m';\nconst y = <A/>;\n`;
    const r = removeImport(src, { module: './m', named: ['A'] });
    expect(r.located).toBe(false);
    expect(r.reason).toBe('still referenced elsewhere');
    expect(r.text).toBe(src);
  });

  it('drops an unreferenced specifier, leaving the others', () => {
    const src = `import { A, B } from './m';\nconst y = <B/>;\n`;
    const r = removeImport(src, { module: './m', named: ['A'] });
    expect(r.located).toBe(true);
    expect(r.text).toContain(`import { B } from './m';`);
  });

  it('removes the whole statement when nothing is left', () => {
    const src = `import { A } from './m';\nconst y = 1;\n`;
    const r = removeImport(src, { module: './m', named: ['A'] });
    expect(r.located).toBe(true);
    expect(r.text).toBe(`const y = 1;\n`);
  });

  it('reports a module it does not import', () => {
    const r = removeImport(`const x = 1;\n`, { module: './nope', named: ['A'] });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/no import of/);
  });
});

// --- unifiedDiff -----------------------------------------------------------

describe('unifiedDiff', () => {
  it('returns empty for identical input', () => {
    expect(unifiedDiff('a\nb', 'a\nb')).toBe('');
  });

  it('shows one hunk with context around a single change', () => {
    const out = unifiedDiff('a\nb\nc\nd\ne', 'a\nb\nX\nd\ne');
    expect(out).toContain('- c');
    expect(out).toContain('+ X');
    expect(out).toContain('  b');
    expect(out).not.toContain('⋯');
  });

  it('splits distant changes into separate hunks', () => {
    // The bug this exists for: a single-region diff spanning three insertions
    // ~70 lines apart rendered the entire middle of the file as "changed".
    const before = ['x', ...Array.from({ length: 40 }, (_, i) => `l${i}`), 'y'].join('\n');
    const after = before.replace('x', 'X').replace('y', 'Y');
    const out = unifiedDiff(before, after);
    expect(out).toContain('⋯');
    expect(out).not.toContain('l20');
  });
});
