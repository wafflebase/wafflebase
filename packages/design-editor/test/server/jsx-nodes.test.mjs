import { describe, expect, it } from 'vitest';
import {
  attrsOf,
  classLiteralOf,
  directTextOf,
  findJsxRoots,
  fpOf,
  fpxOf,
  isReturnsRoot,
  nodeAt,
  parse,
  resolveNode,
  tagOf,
  walkJsx,
} from '../../src/server/jsx-nodes.mjs';

/**
 * `jsx-nodes.mjs` is the single definition of "which child is index 2", shared by
 * the extractor, the injector and the `data-wb-node` stamper. Its own header says
 * three implementations would drift and that the drift surfaces as an edit
 * landing on the wrong node — SILENTLY. Nothing detects that at runtime, so these
 * tests are the only thing standing between a numbering change and a corrupted
 * source file.
 *
 * They are written against OBSERVED behaviour of the file as it landed, not
 * against what the doc comments claim. Where the two disagree the test says so.
 */

// --- helpers ---------------------------------------------------------------

/** Every walked entry of `component` in `src`. */
function entriesOf(src, component = 'C') {
  const sf = parse(src);
  const root = findJsxRoots(sf).roots[component];
  if (!root) throw new Error(`no root named ${component}`);
  return [...walkJsx(sf, root)];
}

/** `['0.1 <span>', …]` — a compact, diffable picture of the numbering. */
function shapeOf(src, component = 'C') {
  return entriesOf(src, component).map((e) => `${e.path.join('.')} <${e.tag}>`.trim());
}

/** The first walked entry whose tag matches. */
function find(src, tag, component = 'C') {
  const e = entriesOf(src, component).find((x) => x.tag === tag);
  if (!e) throw new Error(`no <${tag}> in ${component}`);
  return e;
}

/** Resolve `tag`'s own anchor against its own source — the happy path. */
function selfResolve(src, tag, opts, component = 'C') {
  const sf = parse(src);
  const root = findJsxRoots(sf).roots[component];
  const e = [...walkJsx(sf, root)].find((x) => x.tag === tag);
  return resolveNode(sf, { component, path: e.path, tag: e.tag, fp: e.fp, fpx: e.fpx }, opts);
}

// --- the synthetic returns root -------------------------------------------

describe('the synthetic returns root', () => {
  it('wraps EVERY returned JSX expression, not just the first', () => {
    // The bug this exists for: taking "the first return" as the root reduced a
    // 1648-line SheetView to a single <Loader/>, because the component opens
    // with `if (loading) return <Loader/>`. Both returns are real render output.
    expect(shapeOf(`
      function C() {
        if (loading) return <Loader/>;
        return <div><span/></div>;
      }`)).toEqual(['<#returns>', '0 <Loader>', '1 <div>', '1.0 <span>']);
  });

  it('is present for a SINGLE return too, so [0] means the same thing either way', () => {
    // The whole point of making the container unconditional: adding a guard
    // clause later must not renumber every path in the file.
    expect(shapeOf(`function C() { return <div/>; }`)).toEqual(['<#returns>', '0 <div>']);
  });

  it('ignores returns that carry no JSX', () => {
    expect(shapeOf(`
      function C() {
        if (x) return null;
        return <div/>;
      }`)).toEqual(['<#returns>', '0 <div>']);
  });

  it('is reported by isReturnsRoot and tags as #returns', () => {
    const root = entriesOf(`function C() { return <div/>; }`)[0];
    expect(isReturnsRoot(root.node)).toBe(true);
    expect(tagOf(root.node)).toBe('#returns');
    expect(root.path).toEqual([]);
  });

  it('is refused by resolveNode — there is nothing to edit on a return list', () => {
    const r = selfResolve(`function C() { return <div/>; }`, '#returns');
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/not editable/);
  });
});

// --- child numbering -------------------------------------------------------

describe('child numbering', () => {
  it('does not number JsxText or comments', () => {
    expect(shapeOf(`
      function C() {
        return <div>
          hello {/* a comment */}
          <b/>
        </div>;
      }`)).toEqual(['<#returns>', '0 <div>', '0.0 <b>']);
  });

  it('treats a fragment as transparent — its children number into the parent', () => {
    // A fragment has no rendered presence, so wrapping siblings in one must not
    // renumber the subtree. <C2> stays at index 2, exactly where it would be
    // without the wrapper.
    expect(shapeOf(`function C() { return <div><><A/><B/></><C2/></div>; }`))
      .toEqual(['<#returns>', '0 <div>', '0.0 <A>', '0.1 <B>', '0.2 <C2>']);
  });

  it('numbers BOTH ternary branches as distinct source nodes', () => {
    // They are mutually exclusive at runtime but both exist in source, and both
    // are separately editable.
    expect(shapeOf(`function C() { return <div>{ok ? <Yes/> : <No/>}</div>; }`))
      .toEqual(['<#returns>', '0 <div>', '0.0 <Yes>', '0.1 <No>']);
  });

  it('descends into && and || so conditional renders stay addressable', () => {
    expect(shapeOf(`function C() { return <div>{ok && <Maybe/>}{alt || <Fallback/>}</div>; }`))
      .toEqual(['<#returns>', '0 <div>', '0.0 <Maybe>', '0.1 <Fallback>']);
  });

  it('descends through parentheses', () => {
    expect(shapeOf(`function C() { return (<div>{(<b/>)}</div>); }`))
      .toEqual(['<#returns>', '0 <div>', '0.0 <b>']);
  });

  it('contributes nothing for a call passing a function REFERENCE', () => {
    // `items.map(renderRow)` has no inline JSX. This is not a gap: renderRow
    // becomes its own walkable root where its JSX is static and fully editable.
    const src = `
      function C() { return <ul>{items.map(renderRow)}</ul>; }
      function renderRow(d) { return <li><b/></li>; }`;
    expect(shapeOf(src)).toEqual(['<#returns>', '0 <ul>']);
    expect(shapeOf(src, 'renderRow')).toEqual(['<#returns>', '0 <li>', '0.0 <b>']);
  });
});

// --- scope -----------------------------------------------------------------

describe('scope', () => {
  it('demotes to iteration inside a known iteration method', () => {
    const li = find(`function C() { return <ul>{items.map(d => <li/>)}</ul>; }`, 'li');
    expect(li.scope).toBe('iteration');
  });

  it('demotes to callback for any other inline-function call', () => {
    const memo = find(`function C() { return <div>{useMemo(() => <Memo/>, [])}</div>; }`, 'Memo');
    expect(memo.scope).toBe('callback');
  });

  it('never recovers once demoted, however deep the nesting', () => {
    // A static-looking `{cond && <b/>}` INSIDE a .map body is still iteration —
    // it is rendered N times, so a structural edit there is not well-defined.
    const es = entriesOf(`
      function C() {
        return <ul>{items.map(d => <li>{d.x && <b/>}</li>)}</ul>;
      }`);
    expect(es.map((e) => `${e.tag}:${e.scope}`)).toEqual([
      '#returns:static', 'ul:static', 'li:iteration', 'b:iteration',
    ]);
  });

  it('starts static again in a helper reached by reference', () => {
    const li = find(`
      function C() { return <ul>{items.map(renderRow)}</ul>; }
      function renderRow(d) { return <li/>; }`, 'li', 'renderRow');
    expect(li.scope).toBe('static');
  });
});

// --- owner (the splice-safety flag) ---------------------------------------

describe('owner', () => {
  it('is the node itself for a plain element child', () => {
    const e = find(`function C() { return <div><b/></div>; }`, 'b');
    expect(e.owner).toBe(e.node);
  });

  it('is the node itself for a child of a directly-reached fragment', () => {
    // A fragment has no rendered presence, so it must not confer ownership on
    // its children — the splice offset for <b/> is <b/>'s own.
    const e = find(`function C() { return <div><><b/><i/></></div>; }`, 'b');
    expect(e.owner).toBe(e.node);
  });

  it('is the {…} expression for a fragment child reached through one', () => {
    const e = find(`function C() { return <div>{ok && <><b/><i/></>}</div>; }`, 'b');
    expect(e.owner).not.toBe(e.node);
  });

  it('is the whole {…} expression for a conditionally-rendered child', () => {
    // Splice offsets must come from the OWNER: inserting after the <b/> inside
    // `{ok && <b/>}` would land before the `}` and produce a syntax error.
    const e = find(`function C() { return <div>{ok && <b/>}</div>; }`, 'b');
    expect(e.owner).not.toBe(e.node);
  });

  it('blocks structural edits on a conditionally-rendered node', () => {
    const r = selfResolve(`function C() { return <div>{ok && <b/>}</div>; }`, 'b', { requireStatic: true });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/sits inside a \{…\} expression/);
  });

  it('allows structural edits on a plain static child', () => {
    const r = selfResolve(`function C() { return <div><b/></div>; }`, 'b', { requireStatic: true });
    expect(r.located).toBe(true);
  });

  it('allows structural edits on a child of a directly-reached fragment', () => {
    // A fragment is transparent for OWNERSHIP as well as for numbering: splicing
    // a sibling in beside <A/> inside `<><A/><B/></>` is legal JSX. Wrapping a
    // subtree in a fragment must therefore not change what is editable — the
    // assertion is an equality between the two sources, not just `located`.
    const withFragment = selfResolve(
      `function C() { return <div><><A/><B/></></div>; }`, 'A', { requireStatic: true });
    const without = selfResolve(
      `function C() { return <div><A/><B/></div>; }`, 'A', { requireStatic: true });

    expect(without.located).toBe(true);
    expect(withFragment.located).toBe(true);
  });

  it('allows structural edits on a child of a RETURNED fragment', () => {
    // The other way a fragment is reached directly: as the returned expression
    // itself, where `owner === expr` rather than `owner === c`.
    const r = selfResolve(`function C() { return <><A/><B/></>; }`, 'A', { requireStatic: true });
    expect(r.located).toBe(true);
  });

  it('still blocks structural edits on a fragment reached through {…}', () => {
    // The fix must not widen past directly-reached fragments. Here removing
    // <A/> would leave `{cond && <></>}` and removing the container would drop
    // the condition, so the `{…}` stays the owner and the refusal stands.
    const r = selfResolve(
      `function C() { return <div>{cond && <><A/><B/></>}</div>; }`, 'A', { requireStatic: true });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/sits inside a \{…\} expression/);
  });

  it('refuses structural edits in an iteration scope with an actionable reason', () => {
    const r = selfResolve(`function C() { return <ul>{items.map(d => <li/>)}</ul>; }`, 'li', { requireStatic: true });
    expect(r.located).toBe(false);
    expect(r.scope).toBe('iteration');
    expect(r.reason).toMatch(/Extract the row into a component or a render helper/);
  });
});

// --- fp: the stable identity ----------------------------------------------

describe('fpOf', () => {
  const fpOfTag = (src, tag = 'div') => find(src, tag).fp;

  it('EXCLUDES className content — the most-edited attribute', () => {
    // Including it would make every class edit invalidate its own anchor, and
    // its own revert's anchor too (a revert resolves against the post-edit tree).
    expect(fpOfTag(`function C(){ return <div className="a"/>; }`))
      .toBe(fpOfTag(`function C(){ return <div className="totally different"/>; }`));
  });

  it('EXCLUDES the child tag sequence', () => {
    // An insert changes the PARENT's sequence, so a second op on that parent in
    // the same batch would otherwise find a stale fp.
    expect(fpOfTag(`function C(){ return <div><b/></div>; }`))
      .toBe(fpOfTag(`function C(){ return <div><b/><i/></div>; }`));
  });

  it('EXCLUDES source offsets — an edit ABOVE a node does not move its identity', () => {
    expect(fpOfTag(`function C(){ return <section><div id="x"/></section>; }`, 'div'))
      .toBe(fpOfTag(`function C(){ return <section><p>inserted above</p><div id="x"/></section>; }`, 'div'));
  });

  it('is insensitive to attribute ORDER but sensitive to the attribute SET', () => {
    expect(fpOfTag(`function C(){ return <div id="x" role="main"/>; }`))
      .toBe(fpOfTag(`function C(){ return <div role="main" id="x"/>; }`));
    expect(fpOfTag(`function C(){ return <div id="x"/>; }`))
      .not.toBe(fpOfTag(`function C(){ return <div id="x" role="main"/>; }`));
  });

  it('is sensitive to identity-attribute VALUES', () => {
    expect(fpOfTag(`function C(){ return <div id="x"/>; }`))
      .not.toBe(fpOfTag(`function C(){ return <div id="y"/>; }`));
  });

  it('blocks the cross-subtree false match via ancestorTags', () => {
    // Same tag, same attrs, different branch of the tree. Landing an edit in the
    // wrong subtree is the more dangerous confusion, so ancestors are in.
    const es = entriesOf(`function C(){ return <div><header><b/></header><footer><b/></footer></div>; }`);
    const [b1, b2] = es.filter((e) => e.tag === 'b');
    expect(b1.fp).not.toBe(b2.fp);
  });

  it('COLLIDES for identical siblings, by design', () => {
    // login/page.tsx has two byte-identical <span className="mx-2 opacity-50">·
    // </span>. fp cannot tell them apart, which is why resolveNode treats
    // ambiguity as absence rather than picking one.
    const es = entriesOf(`function C(){ return <div><b/><b/></div>; }`);
    const [b1, b2] = es.filter((e) => e.tag === 'b');
    expect(b1.fp).toBe(b2.fp);
    expect(b1.path).not.toEqual(b2.path);
  });

  it('is a short hex digest and is pure', () => {
    const args = { ancestorTags: ['div'], tag: 'b', attrNames: ['id'], identity: { id: 'x' }, text: 'hi' };
    expect(fpOf(args)).toMatch(/^[0-9a-f]{8}$/);
    expect(fpOf(args)).toBe(fpOf(args));
  });

  it('tolerates missing optional fields', () => {
    expect(fpOf({ tag: 'div', identity: {} })).toMatch(/^[0-9a-f]{8}$/);
  });
});

// --- fpx: the search key ---------------------------------------------------

describe('fpxOf', () => {
  const fpxOfTag = (src, tag = 'div') => find(src, tag).fpx;

  it('restores exactly what fp omits: class content and child tags', () => {
    expect(fpxOfTag(`function C(){ return <div className="a"/>; }`))
      .not.toBe(fpxOfTag(`function C(){ return <div className="b"/>; }`));
    expect(fpxOfTag(`function C(){ return <div><b/></div>; }`))
      .not.toBe(fpxOfTag(`function C(){ return <div><b/><i/></div>; }`));
  });

  it('sorts class tokens so a reorder does not invalidate it', () => {
    expect(fpxOfTag(`function C(){ return <div className="p-2 flex"/>; }`))
      .toBe(fpxOfTag(`function C(){ return <div className="flex p-2"/>; }`));
  });

  it('is derived from fp, so an fp change always changes fpx', () => {
    expect(fpxOf('aaaaaaaa', 'flex', ['b'])).not.toBe(fpxOf('bbbbbbbb', 'flex', ['b']));
  });

  it('treats absent className and empty className alike', () => {
    expect(fpxOf('aaaaaaaa', null, [])).toBe(fpxOf('aaaaaaaa', '   ', []));
  });
});

// --- resolveNode -----------------------------------------------------------

describe('resolveNode', () => {
  const src = `function C(){ return <div><b id="one"/><i id="two"/></div>; }`;

  it('takes the path hint when tag and fp both agree, and reports no relocation', () => {
    const r = selfResolve(src, 'i');
    expect(r.located).toBe(true);
    expect(r.entry.tag).toBe('i');
    expect(r.relocated).toBe(false);
  });

  it('relocates via a unique fpx when the path hint is stale', () => {
    const sf = parse(src);
    const e = [...walkJsx(sf, findJsxRoots(sf).roots.C)].find((x) => x.tag === 'i');
    const r = resolveNode(sf, { component: 'C', path: [9, 9], tag: 'i', fp: e.fp, fpx: e.fpx });
    expect(r.located).toBe(true);
    expect(r.entry.path).toEqual(e.path);
    expect(r.relocated).toBe(true);
  });

  it('relocates via a unique fp when fpx is absent', () => {
    const sf = parse(src);
    const e = [...walkJsx(sf, findJsxRoots(sf).roots.C)].find((x) => x.tag === 'i');
    const r = resolveNode(sf, { component: 'C', path: [9], tag: 'i', fp: e.fp });
    expect(r.located).toBe(true);
    expect(r.relocated).toBe(true);
  });

  it('refuses a path whose node has the wrong TAG even if the path exists', () => {
    const sf = parse(src);
    const r = resolveNode(sf, { component: 'C', path: [0, 0], tag: 'span', fp: 'deadbeef' });
    expect(r.located).toBe(false);
  });

  it('treats AMBIGUITY AS ABSENCE and never picks the first match', () => {
    // The single most important property in this file. Two byte-identical
    // siblings share an fp AND an fpx; resolving to either would write to the
    // wrong node silently. The candidate paths come back so the UI can offer
    // "re-point this edit" instead of only "discard".
    const amb = `function C(){ return <div><b className="x"/><b className="x"/></div>; }`;
    const sf = parse(amb);
    const e = [...walkJsx(sf, findJsxRoots(sf).roots.C)].find((x) => x.tag === 'b');
    const r = resolveNode(sf, { component: 'C', path: [9], tag: 'b', fp: e.fp, fpx: e.fpx });

    expect(r.located).toBe(false);
    expect(r.candidates).toEqual([[0, 0], [0, 1]]);
    expect(r.reason).toMatch(/2 candidates/);
  });

  it('reports zero candidates distinctly from ambiguous ones', () => {
    const sf = parse(src);
    const r = resolveNode(sf, { component: 'C', path: [0], tag: 'b', fp: '00000000' });
    expect(r.located).toBe(false);
    expect(r.candidates).toEqual([]);
    expect(r.reason).toMatch(/0 candidates/);
  });

  it('names the missing component rather than throwing', () => {
    const r = resolveNode(parse(src), { component: 'Nope', path: [], tag: 'div', fp: 'x' });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/no JSX-returning function named Nope/);
  });

  it('refuses a component name two functions claim, even on a perfect path hit', () => {
    // The dangerous shape: the anchor was recorded against the FIRST `Row`, and
    // the second one happens to carry a node with the same tag at the same path.
    // Resolving would edit the wrong function with nothing reporting it, so the
    // name is refused the way an ambiguous fingerprint already is.
    const dup = `
      function One() { const Row = () => <li><b/></li>; return <ul>{items.map(Row)}</ul>; }
      function Two() { const Row = () => <li><b/></li>; return <ul>{cells.map(Row)}</ul>; }`;
    const sf = parse(dup);
    const e = [...walkJsx(sf, findJsxRoots(sf).roots.Row)].find((x) => x.tag === 'b');

    const r = resolveNode(sf, { component: 'Row', path: e.path, tag: 'b', fp: e.fp, fpx: e.fpx });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/more than one JSX-returning function is named Row/);
  });

  it('resolves a node that survived an edit ABOVE it, without relocating', () => {
    // The everyday case: an earlier intent in the same batch inserted a sibling
    // above. Offsets moved, the path did not, so this must still be a path hit.
    const before = `function C(){ return <div><b id="one"/><i id="two"/></div>; }`;
    const after = `function C(){ return <div><b id="one"/><i id="two"/><u/></div>; }`;
    const sfB = parse(before);
    const e = [...walkJsx(sfB, findJsxRoots(sfB).roots.C)].find((x) => x.tag === 'i');

    const r = resolveNode(parse(after), { component: 'C', path: e.path, tag: 'i', fp: e.fp, fpx: e.fpx });
    expect(r.located).toBe(true);
    expect(r.relocated).toBe(false);
  });
});

// --- nodeAt ----------------------------------------------------------------

describe('nodeAt', () => {
  const src = `function C(){ return <div><b/><i><u/></i></div>; }`;
  const rootOf = (s) => {
    const sf = parse(s);
    return { sf, root: findJsxRoots(sf).roots.C };
  };

  it('agrees with walkJsx about every path that exists', () => {
    // walkJsx feeds the client outline; nodeAt is how a write finds its target.
    // If one can reach a node the other cannot, a visible row is uneditable.
    const { sf, root } = rootOf(src);
    for (const e of walkJsx(sf, root)) {
      expect(nodeAt(sf, root, e.path)).toBe(e.node);
    }
  });

  it('returns the root for the empty path', () => {
    const { sf, root } = rootOf(src);
    expect(nodeAt(sf, root, [])).toBe(root);
  });

  it('returns null past a leaf and for a negative index, never a wrapped node', () => {
    const { sf, root } = rootOf(src);
    expect(nodeAt(sf, root, [9])).toBeNull();
    expect(nodeAt(sf, root, [0, 0, 0])).toBeNull(); // <b/> is a leaf
    expect(nodeAt(sf, root, [-1])).toBeNull();
    // …while the sibling one index over IS real, so the guard is not just
    // "anything long returns null".
    expect(tagOf(nodeAt(sf, root, [0, 1, 0]))).toBe('u');
  });

  it('tracks scope while descending, so nested iteration paths still resolve', () => {
    const s = `function C(){ return <ul>{items.map(d => <li><b/></li>)}</ul>; }`;
    const { sf, root } = rootOf(s);
    expect(tagOf(nodeAt(sf, root, [0, 0, 0]))).toBe('b');
  });
});

// --- findJsxRoots ----------------------------------------------------------

describe('findJsxRoots', () => {
  it('finds function declarations, arrow consts, and local render helpers', () => {
    const { roots } = findJsxRoots(parse(`
      function A() { return <div/>; }
      const B = () => <div/>;
      const C = function () { return <div/>; };
      function notAComponent() { return 42; }`));
    expect(Object.keys(roots).sort()).toEqual(['A', 'B', 'C']);
  });

  it('records `export default function` by name', () => {
    const { defaultExport } = findJsxRoots(parse(`export default function Page() { return <div/>; }`));
    expect(defaultExport).toBe('Page');
  });

  it('records a separate `export default Name` statement', () => {
    const { defaultExport } = findJsxRoots(parse(`
      const Page = () => <div/>;
      export default Page;`));
    expect(defaultExport).toBe('Page');
  });

  it('leaves defaultExport null when there is none', () => {
    expect(findJsxRoots(parse(`function C() { return <div/>; }`)).defaultExport).toBeNull();
  });

  it('reports a name two JSX-returning functions claim as ambiguous', () => {
    // `visit` recurses over the whole file, so a local helper inside each of two
    // components registers twice under one key. The surviving root is whichever
    // was visited last, which is not a fact an anchor can know.
    const { roots, ambiguous } = findJsxRoots(parse(`
      function One() { const Row = () => <li/>; return <ul>{items.map(Row)}</ul>; }
      function Two() { const Row = () => <td/>; return <tr>{cells.map(Row)}</tr>; }`));
    expect([...ambiguous]).toEqual(['Row']);
    // Still present — `roots` stays a complete index; refusal is `resolveNode`'s
    // job, so a future caller that CAN disambiguate is not locked out.
    expect(Object.keys(roots).sort()).toEqual(['One', 'Row', 'Two']);
  });

  it('leaves ambiguous empty when every name is unique', () => {
    const { ambiguous } = findJsxRoots(parse(`
      function A() { return <div/>; }
      const B = () => <div/>;`));
    expect(ambiguous.size).toBe(0);
  });

  it('does not treat a callback return as the enclosing function output', () => {
    // The `useEffect` cleanup and `.map` bodies belong to their own scope. If
    // they leaked into the component's return list they would be numbered as
    // top-level renders.
    expect(shapeOf(`
      function C() {
        useEffect(() => { return () => cleanup(); }, []);
        return <div/>;
      }`)).toEqual(['<#returns>', '0 <div>']);
  });
});

// --- attribute + text readers ---------------------------------------------

describe('attrsOf', () => {
  const attrsOfDiv = (src) => attrsOf(find(src, 'div').node);

  it('lists names in source order and marks a spread as "..."', () => {
    expect(attrsOfDiv(`function C(){ return <div {...rest} id="x" onClick={h}/>; }`).names)
      .toEqual(['...', 'id', 'onClick']);
  });

  it('captures only IDENTITY_ATTRS into identity', () => {
    const { identity } = attrsOfDiv(`function C(){ return <div id="x" role="main" onClick={h} title="t"/>; }`);
    expect(identity).toEqual({ id: 'x', role: 'main' });
  });

  it('records a bare boolean identity attribute as "true"', () => {
    expect(attrsOfDiv(`function C(){ return <div value/>; }`).identity).toEqual({ value: 'true' });
  });

  it('records an expression identity value by its source text', () => {
    expect(attrsOfDiv(`function C(){ return <div id={user.id}/>; }`).identity).toEqual({ id: 'user.id' });
  });

  it('returns empty lists for the returns root', () => {
    const root = entriesOf(`function C(){ return <div/>; }`)[0];
    expect(attrsOf(root.node)).toEqual({ names: [], identity: {}, className: null });
  });
});

describe('classLiteralOf', () => {
  const classOf = (src) => {
    const lit = classLiteralOf(find(src, 'div').node);
    return lit ? lit.text : null;
  };

  it('reads a plain string, a braced string, and a template literal', () => {
    expect(classOf(`function C(){ return <div className="a b"/>; }`)).toBe('a b');
    expect(classOf(`function C(){ return <div className={"a b"}/>; }`)).toBe('a b');
    expect(classOf('function C(){ return <div className={`a b`}/>; }')).toBe('a b');
  });

  it('takes the FIRST string literal inside a cn() call', () => {
    // The authored class blob in every shadcn/cn() call in this codebase.
    // Editing anything else would be a guess.
    expect(classOf(`function C(){ return <div className={cn("a b", other && "c")}/>; }`)).toBe('a b');
  });

  it('returns null when there is no literal to edit', () => {
    expect(classOf(`function C(){ return <div className={other}/>; }`)).toBeNull();
    expect(classOf(`function C(){ return <div id="x"/>; }`)).toBeNull();
  });
});

describe('directTextOf', () => {
  it('collapses whitespace across direct text children only', () => {
    expect(directTextOf(find(`
      function C(){ return <div>  hello
         world  <b>NOT THIS</b>tail</div>; }`, 'div').node)).toBe('hello world tail');
  });

  it('is empty for an element with no text and for the returns root', () => {
    expect(directTextOf(find(`function C(){ return <div><b/></div>; }`, 'div').node)).toBe('');
    expect(directTextOf(entriesOf(`function C(){ return <div/>; }`)[0].node)).toBe('');
  });
});

// --- parse -----------------------------------------------------------------

describe('parse', () => {
  it('parses TSX with generics and type annotations', () => {
    const es = entriesOf(`
      function C(): JSX.Element {
        const x = useRef<HTMLDivElement>(null);
        return <div ref={x}><b/></div>;
      }`);
    expect(es.map((e) => e.tag)).toEqual(['#returns', 'div', 'b']);
  });

  it('keeps parent pointers, which every getText() call depends on', () => {
    // ts.createSourceFile(..., setParentNodes = true). Without it, getText()
    // throws and every tag/attribute read in this module fails.
    const sf = parse(`function C(){ return <div id="x"/>; }`);
    const e = [...walkJsx(sf, findJsxRoots(sf).roots.C)].find((x) => x.tag === 'div');
    expect(() => e.node.getText()).not.toThrow();
  });
});
