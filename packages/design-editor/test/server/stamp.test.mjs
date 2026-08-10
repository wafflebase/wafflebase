import { describe, expect, it } from 'vitest';
import { findJsxRoots, isReturnsRoot, parse, walkJsx } from '../../src/server/jsx-nodes.mjs';
import { stampSource } from '../../src/server/stamp.mjs';

/**
 * `stamp.mjs` is the THIRD consumer of the `jsx-nodes.mjs` numbering — the
 * extractor emits paths with it, the injector resolves anchors with it, and this
 * writes it into the DOM so a click can be mapped back to source.
 *
 * The failure it exists to prevent is a click selecting the WRONG node, which
 * produces no error anywhere. The guard is that the numbering is imported and
 * never re-derived; the cross-agreement test below is what proves that stayed
 * true.
 */

/** All `data-wb-node` values in a stamped string, in source order. */
function idsIn(text) {
  return [...text.matchAll(/data-wb-node="([^"]+)"/g)].map((m) => m[1]);
}

/** `{ 'C:0.1': 'a1b2c3d4', … }` from a stamped string. */
function fpsIn(text) {
  const out = {};
  for (const m of text.matchAll(/data-wb-node="([^"]+)" data-wb-fp="([^"]+)"/g)) out[m[1]] = m[2];
  return out;
}

/** Every `<root>:<path>` `walkJsx` would produce, skipping the returns root. */
function expectedIds(src) {
  const sf = parse(src);
  const ids = [];
  for (const [rootName, root] of Object.entries(findJsxRoots(sf).roots)) {
    for (const e of walkJsx(sf, root)) {
      if (isReturnsRoot(e.node)) continue;
      if (e.tag === '<>') continue; // a fragment has no attribute list to stamp
      ids.push(`${rootName}:${e.path.join('.')}`);
    }
  }
  return ids;
}

// A component exercising every numbering rule at once: multiple returns, a
// fragment, a ternary, a conditional, an iteration, and a sibling helper root.
const KITCHEN_SINK = `
  function Page({ items, ok, loading }) {
    if (loading) return <Loader/>;
    return (
      <div className="wrap">
        <><Header/><Nav/></>
        {ok ? <Yes/> : <No/>}
        {ok && <Maybe/>}
        <ul>{items.map((d) => <li key={d.id}><b/></li>)}</ul>
      </div>
    );
  }
  function Row() {
    return <tr><td/></tr>;
  }
`;

describe('what gets stamped', () => {
  it('writes all three attributes on a plain element', () => {
    const { text } = stampSource(`function C(){ return <div/>; }`, 'src/a.tsx');
    expect(text).toContain('data-wb-node="C:0"');
    expect(text).toMatch(/data-wb-fp="[0-9a-f]{8}"/);
    expect(text).toContain('data-wb-file="src/a.tsx"');
  });

  it('returns the ids it wrote, matching the text exactly', () => {
    const { text, stamped } = stampSource(`function C(){ return <div><b/></div>; }`, 'f.tsx');
    expect(stamped).toEqual(['C:0', 'C:0.0']);
    expect(idsIn(text)).toEqual(stamped);
  });

  it('skips the synthetic returns root — there is no element to stamp', () => {
    const { stamped } = stampSource(`function C(){ return <div/>; }`, 'f.tsx');
    expect(stamped).not.toContain('C:');
    expect(stamped).toEqual(['C:0']);
  });

  it('skips a fragment itself but still stamps its children', () => {
    // A fragment has no attribute list. Its children are transparent in the
    // numbering, so they take indices in the PARENT's list.
    const { text, stamped } = stampSource(`function C(){ return <div><><A/><B/></></div>; }`, 'f.tsx');
    expect(stamped).toEqual(['C:0', 'C:0.0', 'C:0.1']);
    expect(text).toContain('<><A data-wb-node="C:0.0"');
  });

  it('prefixes each root with its own name, so two files can share a path', () => {
    const { stamped } = stampSource(
      `function Page(){ return <div/>; }\nfunction Row(){ return <li/>; }`, 'f.tsx');
    expect(stamped).toEqual(['Page:0', 'Row:0']);
  });

  it('stamps inside an iteration body', () => {
    const { stamped } = stampSource(`function C(){ return <ul>{items.map(d => <li/>)}</ul>; }`, 'f.tsx');
    expect(stamped).toEqual(['C:0', 'C:0.0']);
  });
});

describe('agreement with jsx-nodes (the drift guard)', () => {
  it('stamps exactly the ids walkJsx yields, for every numbering rule at once', () => {
    // THE test in this file. If the stamper ever re-derives numbering instead of
    // importing it, this is what fails — and without it the symptom in
    // production is a click silently selecting a different element.
    const { stamped } = stampSource(KITCHEN_SINK, 'f.tsx');
    expect(stamped).toEqual(expectedIds(KITCHEN_SINK));
  });

  it('covers both roots and both returns of the multi-return component', () => {
    // Guards the guard: if expectedIds() and stamped were both empty, or both
    // collapsed to the first return, the test above would still pass.
    const { stamped } = stampSource(KITCHEN_SINK, 'f.tsx');
    expect(stamped).toContain('Page:0');   // the `if (loading)` return
    expect(stamped).toContain('Page:1');   // the main return
    expect(stamped).toContain('Row:0');    // the sibling helper root
    expect(stamped).toContain('Page:1.5.0'); // <li> inside the .map
    expect(stamped.length).toBeGreaterThan(10);
  });

  it('writes the fp jsx-nodes computed, not one re-derived from the stamped tree', () => {
    // The stamped fp must be the BASELINE fingerprint. The host matches a click
    // against baseline metadata with it, so a re-derived value would resolve
    // against the wrong frame.
    const src = `function C(){ return <div className="a"><b id="x"/></div>; }`;
    const sf = parse(src);
    const walked = {};
    for (const e of walkJsx(sf, findJsxRoots(sf).roots.C)) {
      if (!isReturnsRoot(e.node)) walked[`C:${e.path.join('.')}`] = e.fp;
    }
    expect(fpsIn(stampSource(src, 'f.tsx').text)).toEqual(walked);
  });
});

describe('the stamped output is still valid source', () => {
  const FIXTURES = [
    ['plain', `function C(){ return <div><b/></div>; }`],
    ['self-closing with props', `function C(){ return <img src="a" alt=""/>; }`],
    ['fragment', `function C(){ return <div><><A/><B/></></div>; }`],
    ['iteration', `function C(){ return <ul>{items.map(d => <li/>)}</ul>; }`],
    ['ternary', `function C(){ return <div>{ok ? <Yes/> : <No/>}</div>; }`],
    ['member tag', `function C(){ return <Card.Header title="t"/>; }`],
    ['spread first', `function C(){ return <div {...rest} id="x"/>; }`],
    ['kitchen sink', KITCHEN_SINK],
  ];

  it.each(FIXTURES)('re-parses without syntax errors: %s', (_label, src) => {
    const { text } = stampSource(src, 'f.tsx');
    expect(parse(text).parseDiagnostics ?? []).toEqual([]);
  });

  it('inserts AFTER type arguments, not between the tag and them', () => {
    // `attributes.pos` sits after the tag name AND any type args;
    // `tagName.end` does not. Splicing at the latter would produce
    // `<Select data-wb-node="…"<string> …>` — a syntax error.
    const { text } = stampSource(`function C(){ return <Select<string> value={v}/>; }`, 'f.tsx');
    expect(text).toContain('<Select<string> data-wb-node="C:0"');
    expect(parse(text).parseDiagnostics ?? []).toEqual([]);
  });

  it('preserves the original attributes and their order', () => {
    const { text } = stampSource(`function C(){ return <div {...rest} id="x" onClick={h}/>; }`, 'f.tsx');
    expect(text).toMatch(/\{\.\.\.rest\} id="x" onClick=\{h\}/);
  });

  it('applies every splice correctly when there are many', () => {
    // Edits are sorted highest-offset-first so earlier offsets stay valid. If
    // that ordering broke, later attributes would land mid-token.
    const src = `function C(){ return <a><b><c><d><e/></d></c></b></a>; }`;
    const { text, stamped } = stampSource(src, 'f.tsx');
    expect(stamped).toEqual(['C:0', 'C:0.0', 'C:0.0.0', 'C:0.0.0.0', 'C:0.0.0.0.0']);
    expect(idsIn(text)).toEqual(stamped);
    expect(parse(text).parseDiagnostics ?? []).toEqual([]);
  });
});

describe('frame stability', () => {
  const src = `function C(){ return <div><b/><i><u/></i></div>; }`;

  it('preserves every PATH through a stamping round-trip', () => {
    // The DOM the designer clicks is the stamped tree. If stamping renumbered
    // anything, the id in the attribute would disagree with the id the client
    // computes for the same node.
    const pathsOf = (s) => {
      const sf = parse(s);
      return [...walkJsx(sf, findJsxRoots(sf).roots.C)].map((e) => e.path.join('.'));
    };
    expect(pathsOf(stampSource(src, 'f.tsx').text)).toEqual(pathsOf(src));
  });

  it('does NOT preserve fingerprints — stamping adds attributes, and fp covers attribute NAMES', () => {
    // Pinned because it is counter-intuitive and load-bearing: the value in
    // `data-wb-fp` is captured BEFORE stamping, which is exactly why the host
    // must read the attribute rather than recompute from the served source.
    const fpsOf = (s) => {
      const sf = parse(s);
      return [...walkJsx(sf, findJsxRoots(sf).roots.C)].map((e) => e.fp);
    };
    expect(fpsOf(stampSource(src, 'f.tsx').text)).not.toEqual(fpsOf(src));
  });

  it('is not idempotent, and double-stamping is a caller error', () => {
    // Second pass sees the injected attributes as ordinary ones and stamps
    // again, producing duplicate attributes. Recorded so nobody assumes it is
    // safe to re-run over already-stamped text.
    const once = stampSource(src, 'f.tsx').text;
    const twice = stampSource(once, 'f.tsx').text;
    expect(twice).not.toBe(once);
    expect([...twice.matchAll(/data-wb-node=/g)].length)
      .toBeGreaterThan([...once.matchAll(/data-wb-node=/g)].length);
  });
});

describe('data-wb-file', () => {
  it('is omitted when no file is given', () => {
    const { text } = stampSource(`function C(){ return <div/>; }`);
    expect(text).toContain('data-wb-node="C:0"');
    expect(text).not.toContain('data-wb-file');
  });

  it('is omitted rather than emitted broken when the path holds JSX-hostile characters', () => {
    // Refusing keeps the output parseable; emitting `data-wb-file="a"b.tsx"`
    // would close the attribute early and corrupt the element.
    for (const bad of ['a"b.tsx', 'a<b.tsx', 'a>b.tsx', 'a&b.tsx']) {
      const { text } = stampSource(`function C(){ return <div/>; }`, bad);
      expect(text).not.toContain('data-wb-file');
      expect(text).toContain('data-wb-node="C:0"'); // still stamped
      expect(parse(text).parseDiagnostics ?? []).toEqual([]);
    }
  });

  it('emits an ordinary repo-relative POSIX path verbatim', () => {
    const { text } = stampSource(
      `function C(){ return <div/>; }`, 'packages/frontend/src/app/page.tsx');
    expect(text).toContain('data-wb-file="packages/frontend/src/app/page.tsx"');
  });
});

describe('degenerate input', () => {
  it('returns the source unchanged when there is no JSX', () => {
    const src = `export const x = 1;\nfunction f() { return 42; }`;
    expect(stampSource(src, 'f.tsx')).toEqual({ text: src, stamped: [] });
  });

  it('returns an empty string unchanged', () => {
    expect(stampSource('', 'f.tsx')).toEqual({ text: '', stamped: [] });
  });
});
