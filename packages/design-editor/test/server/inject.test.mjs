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
        { name: 'label', value: 'labels.save', valueKind: 'expression' },
        { name: 'count', value: '3', valueKind: 'expression' },
      ],
    });
    expect(r.text).toContain('label={labels.save}');
    expect(r.text).toContain('count={3}');
  });

  it('REFUSES attributes whose meaning is unsafe, however well-shaped', () => {
    // `handlers.save` is exactly the bare dotted reference the expression guard
    // is designed to allow, so shape-checking alone accepted
    // `onClick={handlers.save}` and `dangerouslySetInnerHTML={x.y}`. Shape is
    // the wrong question for these names.
    for (const [name, value, valueKind] of [
      ['onClick', 'handlers.save', 'expression'],
      ['onMouseOver', 'handlers.save', 'expression'],
      ['dangerouslySetInnerHTML', 'x.y', 'expression'],
      ['srcDoc', 'hello', 'string'],
    ]) {
      const r = applyLayoutProps(SCENE, {
        anchor: anchorFor(SCENE, 'Alpha'),
        sets: [{ name, value, valueKind }],
      });
      expect(r.located, `${name} was accepted`).toBe(false);
      expect(r.text).toBe(SCENE);
    }
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

  it('strips EVERY occurrence of a repeated class, not just the first', () => {
    // `rewriteClassLiteral`'s removal loop says it does this; nothing checked
    // it, so a regression to a single pass would have been invisible.
    const src = `function C() { return <div className="p-2 gap-1 p-2 mt-1 p-2"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { removals: ['p-2'] },
    });
    expect(r.located, r.reason).toBe(true);
    expect(r.text).toContain('className="gap-1 mt-1"');
  });

  it('refuses a replacement whose `from` carries whitespace', () => {
    // `from` is only ever a search pattern, so it looks harmless — but a
    // whitespace-carrying one builds a matcher spanning two tokens and deletes
    // a neighbour the caller never named.
    const src = `function C() { return <div className="p-2 gap-1"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { replacements: [{ from: 'p-2 gap-1', to: 'x' }] },
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/rejected unsafe class tokens/);
    expect(r.text).toBe(src);
  });

  it('applies the safe ops and reports the rest, rather than all-or-nothing', () => {
    // Partial application is deliberate: one bad token in a batch should not
    // discard the good ones. The REASON is what keeps that honest.
    const src = `function C() { return <div className="p-2"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { additions: ['gap-1', 'bad token', 'mt-1'], removals: ['absent'] },
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('gap-1');
    expect(r.text).toContain('mt-1');
    expect(r.text).not.toContain('bad token');
    expect(r.reason).toMatch(/rejected unsafe class tokens: bad token/);
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
    // The shapes where non-element content sits between the elements. These are
    // the cases that broke when the offset moved off "after the previous
    // element" — the append position has to anchor at the end of the CHILD
    // REGION, not after the last element, or the replay lands before the prose.
    'text + expression before it': [
      `function C() {\n  return (\n    <div>\n      <A/>\n      Some prose here\n      {count}\n      <B/>\n    </div>\n  );\n}\n`,
      'B',
      'div',
    ],
    'expression sibling after it': [
      `function C() {\n  return (\n    <div>\n      <B/>\n      {cond && <A/>}\n    </div>\n  );\n}\n`,
      'B',
      'div',
    ],
    'prose before the only element': [
      `function C() {\n  return (\n    <div>\n      hello there\n      <B/>\n    </div>\n  );\n}\n`,
      'B',
      'div',
    ],
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

// --- the child list vs the bytes between its members -----------------------

/**
 * `childrenOf` numbers JSX ELEMENTS. The source between them holds text and
 * `{expr}` nodes that are not children under that numbering but are very much
 * the author's content — and the splice offset used to be taken after the
 * previous element, so everything in between fell inside the removed span.
 *
 * The offset now anchors immediately BEFORE the child at `index`, which makes
 * "remove one element" mean one element. These tests pin the two halves of that:
 * what survives a remove, and the positions an insert can and cannot name.
 */
describe('non-element siblings are not part of a child', () => {
  const MIXED = `function C() {\n  return (\n    <div>\n      <A/>\n      Some prose here\n      {count}\n      <B/>\n    </div>\n  );\n}\n`;

  it('removing an element leaves neighbouring text and expressions alone', () => {
    const r = applyLayoutRemove(MIXED, { anchor: anchorFor(MIXED, 'B') });
    expect(r.located, r.reason).toBe(true);
    expect(r.text).toContain('Some prose here');
    expect(r.text).toContain('{count}');
    expect(r.text).not.toContain('<B/>');
    // The captured span is the element and its own line — nothing more.
    expect(r.removedText).toBe('\n      <B/>');
  });

  it('inserting before an element lands after the text, not before it', () => {
    const r = applyLayoutInsert(MIXED, {
      parent: anchorFor(MIXED, 'div'),
      index: 1,
      raw: '<NEW/>',
    });
    expect(r.located, r.reason).toBe(true);
    // Order must be: A, prose, {count}, NEW, B.
    const at = (s) => r.text.indexOf(s);
    expect(at('<A/>')).toBeLessThan(at('Some prose here'));
    expect(at('Some prose here')).toBeLessThan(at('{count}'));
    expect(at('{count}')).toBeLessThan(at('<NEW/>'));
    expect(at('<NEW/>')).toBeLessThan(at('<B/>'));
  });
});

describe('positions inside a shared-owner group are refused, not approximated', () => {
  // `{flag ? <A/> : <B/>}` contributes TWO children through ONE owner. There is
  // no offset that means "between the branches", and the old arithmetic silently
  // produced the next index's position instead — indices 1 and 2 wrote
  // byte-identical files, so a designer asking to insert between the branches
  // got an insert after the whole conditional with no indication.
  const TERNARY = `function C() {\n  return (\n    <div>\n      {flag ? <A/> : <B/>}\n      <D/>\n    </div>\n  );\n}\n`;

  it('refuses the interior index with a reason naming the group', () => {
    const r = applyLayoutInsert(TERNARY, {
      parent: anchorFor(TERNARY, 'div'),
      index: 1,
      raw: '<NEW/>',
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/falls inside a single expression that renders 2 children/);
    expect(r.text).toBe(TERNARY);
  });

  it('the surrounding indices stay usable and DISTINCT', () => {
    const outs = [0, 2, 3].map(
      (index) =>
        applyLayoutInsert(TERNARY, { parent: anchorFor(TERNARY, 'div'), index, raw: '<NEW/>' })
          .text,
    );
    for (const t of outs) expect(parse(t, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
    // The bug was two indices agreeing. Distinctness IS the assertion.
    expect(new Set(outs).size).toBe(3);
  });
});

describe('inserting into a conditionally-rendered parent', () => {
  // The case `role: 'container'` was added to unblock: the parent is reached
  // through `{cond && …}`, so `owner !== node` and the target-role guards refuse
  // it — correctly, for a remove. As a CONTAINER it is fine, and this is the
  // end-to-end proof that the widening actually works through `applyLayoutInsert`
  // rather than only at the resolver.
  const COND = `function C() {\n  return (\n    <div>\n      {cond && <Panel>\n        <Inner/>\n      </Panel>}\n    </div>\n  );\n}\n`;

  it('accepts the conditional element as a container and writes a parseable file', () => {
    const r = applyLayoutInsert(COND, {
      parent: anchorFor(COND, 'Panel'),
      index: 1,
      raw: '<NEW/>',
    });
    expect(r.located, r.reason).toBe(true);
    expect(r.text).toContain('<NEW/>');
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
  });

  it('still refuses to REMOVE that same parent — container ≠ target', () => {
    const r = applyLayoutRemove(COND, { anchor: anchorFor(COND, 'Panel') });
    expect(r.located).toBe(false);
    expect(r.text).toBe(COND);
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

// --- hostile input ---------------------------------------------------------

/**
 * `renderAttribute` already refuses an unguarded value, and its comment names
 * the reason: what lands in the file is executed by the next HMR reload, so an
 * unguarded splice is code execution in a dev server. The class and text paths
 * bypassed that guard. These pin them shut.
 *
 * The two contexts get DIFFERENT rules, because the parser gives them different
 * hazards, and conflating them is the trap here:
 *
 *   inside className="…"   `a{b}c` is a StringLiteral with .text `a{b}c` —
 *                          `{`, `}`, `<`, `>` are inert. Only `"` escapes.
 *   inside JSXText         `{e()}` → JsxExpression and `<F/>` → JsxElement,
 *                          both executable; `>` and `}` are parse errors.
 *
 * So text refuses all four, and classes refuse only quotes and whitespace. A
 * class rule that also refused `<`/`>`/braces would reject `[&>svg]:size-4` —
 * real, and used in this repo — while leaving the quote hole open. The
 * "accepts real Tailwind" test below is what stops that from being tightened
 * into uselessness by a later well-meaning pass.
 */
describe('hostile values are refused before they reach the file', () => {
  const EVIL = 'x" onMouseOver={fetch(`//evil`)} y="';

  it('refuses a class token that would break out of the quoted literal', () => {
    const src = `function C() { return <div className="p-4"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { additions: [EVIL] },
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/rejected unsafe class tokens/);
    expect(r.text).toBe(src);
  });

  it('refuses it on the CREATE path too, where no className exists yet', () => {
    // This branch used to interpolate ` className="${additions.join(' ')}"` by
    // hand rather than calling `renderAttribute`, so it accepted what the
    // attribute path refused — and wrote a live event handler onto the element.
    const src = `function C() { return <div><Row/></div>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'Row'),
      classOps: { additions: [EVIL] },
    });
    expect(r.located).toBe(false);
    expect(r.text).toBe(src);
    expect(r.text).not.toContain('onMouseOver');
  });

  it('the refusal stops EXECUTABLE code, not merely a messy string', () => {
    // Positive control first: spliced in, this value is not ugly-but-inert. It
    // parses with ZERO errors as a real event handler — which is what makes the
    // guard load-bearing rather than cosmetic, and what a test asserting only
    // on `reason` would never establish.
    const injected = `function C() { return <div className="p-4 ${EVIL}"/>; }`;
    expect(parse(injected, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
    expect(injected).toContain('onMouseOver={fetch(`//evil`)}');

    const src = `function C() { return <div className="p-4"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { additions: [EVIL] },
    });
    expect(r.text).toBe(src);
    expect(r.text).not.toContain('onMouseOver');
  });

  it('refuses class tokens carrying whitespace or a stray quote', () => {
    const src = `function C() { return <div className="p-4"/>; }`;
    for (const token of ['a b', "a'b", 'a`b', 'a\\b', '']) {
      const r = applyLayoutProps(src, {
        anchor: anchorFor(src, 'div'),
        classOps: { additions: [token] },
      });
      expect(r.located).toBe(false);
      expect(r.text).toBe(src);
    }
  });

  it('ACCEPTS every real Tailwind shape, including the ones with < > and braces', () => {
    // Harvested from packages/frontend. If a later tightening of the class rule
    // rejects one of these, the editor can no longer add the commonest shadcn
    // utilities — which is a worse outcome than the bug the rule guards.
    const src = `function C() { return <div className="p-4"/>; }`;
    const real = [
      '[&>svg]:size-4',
      '[&:not(:first-child)]:border-t',
      '[&::-webkit-scrollbar]:hidden',
      '[&>span:last-child]:truncate',
      'supports-[display:grid]:grid',
      'data-[state=open]:bg-accent',
      'grid-cols-[repeat(auto-fill,minmax(0,1fr))]',
      'bg-[#1da1f2]',
      'w-1/2',
      'p-2.5',
      '!font-bold',
      'hover:bg-red-500',
    ];
    for (const cls of real) {
      const r = applyLayoutProps(src, {
        anchor: anchorFor(src, 'div'),
        classOps: { additions: [cls] },
      });
      expect(r.located, `${cls} was refused`).toBe(true);
      expect(r.text).toContain(cls);
    }
  });

  it('treats a replacement literally instead of as a substitution pattern', () => {
    // `String.prototype.replace` reads `$&` out of a STRING replacement, so this
    // used to write `text-sm-text-sm`. A function replacer has no such grammar.
    const src = `function C() { return <div className="text-sm"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { replacements: [{ from: 'text-sm', to: '$&-$&' }] },
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('className="$&-$&"');
    expect(r.text).not.toContain('text-sm-text-sm');
  });

  it('refuses text that would become a JSX expression or element', () => {
    const src = `function C() {\n  return (\n    <p>\n      hello\n    </p>\n  );\n}\n`;
    for (const text of ['{fetch(`//evil`)}', '<Foo/>', 'a > b', 'a } b']) {
      const r = applyLayoutProps(src, { anchor: anchorFor(src, 'p'), text });
      expect(r.located, `${text} was accepted`).toBe(false);
      expect(r.reason).toMatch(/rejected text containing JSX syntax/);
      expect(r.text).toBe(src);
    }
  });

  it('still accepts ordinary prose, apostrophes and ampersands included', () => {
    const src = `function C() {\n  return (\n    <p>\n      hello\n    </p>\n  );\n}\n`;
    for (const text of ["it's fine", 'Tom & Jerry', 'plain text']) {
      const r = applyLayoutProps(src, { anchor: anchorFor(src, 'p'), text });
      expect(r.located, `${text} was refused`).toBe(true);
      expect(r.text).toContain(text);
      expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
    }
  });

  it('refuses to clobber a non-literal className through the `sets` door', () => {
    // `classOps` refuses this node; `sets` reached the same attribute by another
    // route and overwrote `className={t("nav.home")}` with a plain string,
    // destroying the translation key — the exact loss #718's joiner allowlist
    // exists to prevent. One rule, both doors.
    const src = `function C() { return <div className={t("nav.home")}/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      sets: [{ name: 'className', value: 'clobbered' }],
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/not a string literal/);
    expect(r.text).toBe(src);
  });

  it('refuses to both set and class-edit className in one intent', () => {
    // Their spans are the same attribute; applying highest-first interleaved
    // them into `className="REPLACED"gap-2"` — three parse errors, written.
    const src = `function C() { return <div className="p-4"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { additions: ['gap-2'] },
      sets: [{ name: 'className', value: 'REPLACED' }],
    });
    expect(r.reason).toMatch(/cannot be set and class-edited/);
    expect(r.text).not.toContain('REPLACED');
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
  });

  it('refuses overlapping splices generally, not just the className pair', () => {
    // The backstop, reached here by two `sets` on one attribute. It exists so a
    // future third writer cannot reintroduce the interleaving silently.
    const src = `function C() { return <div id="a" className="p-4"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      sets: [
        { name: 'id', value: 'x' },
        { name: 'id', value: 'y' },
      ],
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/overlapping edits/);
    expect(r.text).toBe(src);
  });

  it('refuses a ${…} token inside a TEMPLATE-literal className', () => {
    // The alphabet depends on the delimiter, and `classLiteralOf` returns
    // backtick literals too. `${alert(1)}` carries no quote, no backtick and no
    // whitespace, so the double-quoted rule waved it through — and it turned the
    // literal into a live TemplateExpression at zero parse errors.
    const src = 'function C() { return <div className={`p-4 gap-2`}/>; }';
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { additions: ['${alert(1)}'] },
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/rejected unsafe class tokens/);
    expect(r.text).toBe(src);
  });

  it('still edits a template-literal className with ordinary classes', () => {
    // The fix must not make backtick literals read-only.
    const src = 'function C() { return <div className={`p-4`}/>; }';
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { additions: ['[&>svg]:size-4'] },
    });
    expect(r.located, r.reason).toBe(true);
    expect(r.text).toContain('`p-4 [&>svg]:size-4`');
  });

  it('allows `$` in a QUOTED literal, where it means nothing', () => {
    // The rule is per-delimiter, not a blanket ban — pinned so it is not
    // "simplified" into rejecting `$` everywhere.
    const src = `function C() { return <div className="p-4"/>; }`;
    const r = applyLayoutProps(src, {
      anchor: anchorFor(src, 'div'),
      classOps: { additions: ['content-[$x]'] },
    });
    expect(r.located, r.reason).toBe(true);
    expect(r.text).toContain('content-[$x]');
  });

  it('refuses a snippet that is not a single JSX element', () => {
    // `intent.raw` was spliced with no validation at all. The middle case is the
    // sharp one: it closes the JSX, runs a call at module scope and reopens the
    // element, and the RESULT PARSES CLEANLY — so nothing downstream would have
    // caught it either.
    for (const [raw, why] of [
      ['</div>); } evil(); function D(){ return (<div>', /not valid JSX/],
      ['<A/><B/>', /single JSX element/],
      ['evil()', /single JSX element/],
    ]) {
      const r = applyLayoutInsert(SCENE, { parent: anchorFor(SCENE, 'div'), index: 1, raw });
      expect(r.located, `${raw} was accepted`).toBe(false);
      expect(r.reason).toMatch(why);
      expect(r.text).toBe(SCENE);
    }
  });

  it('refuses a snippet carrying a disallowed attribute', () => {
    // Otherwise the `sets` denylist is bypassed by inserting the handler
    // instead of setting it.
    for (const raw of ['<X onClick={fetch(`//evil`)}/>', '<X dangerouslySetInnerHTML={x.y}/>']) {
      const r = applyLayoutInsert(SCENE, { parent: anchorFor(SCENE, 'div'), index: 1, raw });
      expect(r.located, `${raw} was accepted`).toBe(false);
      expect(r.reason).toMatch(/disallowed attribute/);
      expect(r.text).toBe(SCENE);
    }
  });

  it('still inserts ordinary snippets, including nested and fragment ones', () => {
    for (const raw of ['<X/>', '<Row><Cell/></Row>', '<p>hello</p>', '<><A/><B/></>']) {
      const r = applyLayoutInsert(SCENE, { parent: anchorFor(SCENE, 'div'), index: 1, raw });
      expect(r.located, `${raw} was refused: ${r.reason}`).toBe(true);
      expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
    }
  });

  it('every accepted insert leaves a parseable file, across shapes and positions', () => {
    // The PROPERTY, asserted over the matrix rather than at one call. It holds
    // today because the snippet is validated and the offset is derived, so this
    // passes with or without the post-splice backstop — which is the honest
    // status of that backstop: redundant by construction, retained because the
    // offset half is what has actually shipped bugs.
    const PARENTS = {
      block: `function C() {\n  return (\n    <div>\n      <A/>\n      <B/>\n    </div>\n  );\n}\n`,
      mixed: `function C() {\n  return (\n    <div>\n      <A/>\n      prose\n      {n}\n      <B/>\n    </div>\n  );\n}\n`,
      oneLine: `function C() { return <div><A/><B/></div>; }`,
      empty: `function C() { return <div></div>; }`,
    };
    let accepted = 0;
    for (const src of Object.values(PARENTS)) {
      const kids = src.match(/<[AB]\/>/g)?.length ?? 0;
      for (let index = 0; index <= kids; index++) {
        for (const raw of ['<X/>', '<Row><Cell/></Row>', '<><A/></>']) {
          const r = applyLayoutInsert(src, { parent: anchorFor(src, 'div'), index, raw });
          if (!r.located) continue;
          accepted++;
          expect(parse(r.text, 'x.tsx').parseDiagnostics ?? [], `${index} ${raw}`).toHaveLength(0);
        }
      }
    }
    expect(accepted).toBeGreaterThan(20); // the matrix is not vacuously empty
  });

  it('leaves `verbatim` replay unvalidated, so undo can restore anything', () => {
    // A captured span came out of a parseable file and may legitimately contain
    // whatever the consumer wrote — handlers included. Validating it would make
    // undo refuse to restore the very thing it removed.
    const src = `function C() {\n  return (\n    <div>\n      <A/>\n      <B onClick={h.save}/>\n    </div>\n  );\n}\n`;
    const rm = applyLayoutRemove(src, { anchor: anchorFor(src, 'B') });
    expect(rm.located, rm.reason).toBe(true);
    const back = applyLayoutInsert(rm.text, {
      parent: anchorFor(src, 'div'),
      index: rm.removedIndex,
      raw: rm.removedText,
      verbatim: true,
    });
    expect(back.located, back.reason).toBe(true);
    expect(back.text).toBe(src);
  });

  it('refuses an all-whitespace snippet instead of reporting a successful insert', () => {
    const r = applyLayoutInsert(SCENE, { parent: anchorFor(SCENE, 'div'), index: 1, raw: '   ' });
    expect(r.located).toBe(false);
    expect(r.reason).toBe('snippet is empty');
    expect(r.text).toBe(SCENE);
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

  it('inserts into an EMPTY named group without a leading comma', () => {
    // `import {} from './m'` is legal input with no element for a new name to
    // follow. The comma-first splice used for a populated group emitted
    // `import {, B }`, which does not parse — so the check is the parser, not
    // just the string.
    const src = `import {} from './m';\n\nconst x = 1;\n`;
    const r = insertImport(src, { module: './m', named: ['B'] });
    expect(r.located).toBe(true);
    expect(r.text).toContain(`import { B } from './m';`);
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
  });

  it('adds a missing DEFAULT binding to an existing named-only import', () => {
    // "an import for this module exists" is not "already imported". Answering
    // `already imported` to this left the caller without the binding it asked
    // for, and a missing import breaks the consumer's build.
    const src = `import { useState } from 'react';\n`;
    const r = insertImport(src, { module: 'react', default: 'React' });
    expect(r.located).toBe(true);
    expect(r.text).toContain(`import React, { useState } from 'react';`);
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
  });

  it('adds a default and a named binding in one call', () => {
    const src = `import { useState } from 'react';\n`;
    const r = insertImport(src, { module: 'react', default: 'React', named: ['useEffect'] });
    expect(r.located).toBe(true);
    expect(r.text).toContain(`import React, { useState, useEffect } from 'react';`);
    expect(parse(r.text, 'x.tsx').parseDiagnostics ?? []).toHaveLength(0);
  });

  it('is a no-op when the requested default is already the one bound', () => {
    const src = `import React from 'react';\n`;
    const r = insertImport(src, { module: 'react', default: 'React' });
    expect(r.located).toBe(false);
    expect(r.reason).toBe('already imported');
    expect(r.text).toBe(src);
  });

  it('refuses a default that would displace a different existing one', () => {
    const src = `import Preact from 'react';\n`;
    const r = insertImport(src, { module: 'react', default: 'React' });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/different default binding \(Preact\)/);
    expect(r.text).toBe(src);
  });

  it('refuses to add a named group beside `default, * as ns`', () => {
    // Appending `, { A }` after the default would have produced
    // `import D, { A }, * as M` — three clauses, which does not parse.
    const src = `import D, * as M from './m';\n`;
    const r = insertImport(src, { module: './m', named: ['A'] });
    expect(r.located).toBe(false);
    expect(r.reason).toBe('unsupported import form');
    expect(r.text).toBe(src);
  });

  it('REFUSES to interpolate an unvalidated specifier', () => {
    // Every part of this statement is concatenated into source. Unvalidated, a
    // module specifier closed its own quote and appended a whole statement that
    // the dev server then ran; a named specifier did the same by closing the
    // brace. `isIdent` and the module rule are why the template is safe.
    const src = `const x = 1;\n`;
    for (const spec of [
      { module: "./m'; evil(); import './n", named: ['A'] },
      { module: './m', named: ['A } from "./z"; evil(); import { B'] },
      { module: './m', default: 'A; evil()' },
      { module: './m\nimport "./z"', named: ['A'] },
    ]) {
      const r = insertImport(src, spec);
      expect(r.located, `${JSON.stringify(spec)} was accepted`).toBe(false);
      expect(r.reason).toMatch(/invalid (module specifier|import specifier|default binding)/);
      expect(r.text).toBe(src);
    }
  });

  it('accepts the module shapes real code uses', () => {
    // The module rule constrains what would ESCAPE the quotes, not a grammar —
    // scopes, deep relative paths and extensions all have to keep working.
    for (const module of ['@scope/pkg', '../../a/b.css', './m.js', 'react-dom/client']) {
      const r = insertImport(`const x = 1;\n`, { module, named: ['A'] });
      expect(r.located, `${module} was refused: ${r.reason}`).toBe(true);
      expect(r.text).toContain(`from '${module}'`);
    }
  });

  it('refuses to add a value binding to a type-only import', () => {
    // `import type { Foo, bar }` typechecks and leaves `bar` undefined at run
    // time — worse than a missing import, because nothing complains.
    const src = `import type { Foo } from './m';\n`;
    const r = insertImport(src, { module: './m', named: ['bar'] });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/type-only import/);
    expect(r.text).toBe(src);
  });

  it('refuses to extend a side-effect import', () => {
    const src = `import './m';\n`;
    const r = insertImport(src, { module: './m', default: 'M' });
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
