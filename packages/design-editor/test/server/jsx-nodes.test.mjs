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

  it('refuses structural edits on a top-level returned element', () => {
    // It is `static` and owns itself, so both existing guards pass it — but
    // there is no sibling list here. A splice would emit
    // `return <div/><span/>;`, which does not parse.
    const r = selfResolve(`function C() { return <div/>; }`, 'div', { requireStatic: true });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/is a whole return value, not a child in a sibling list/);
  });

  it('refuses EVERY return of a multi-return component, not just the first', () => {
    // The guard-clause shape. `[0]` and `[1]` look like siblings to the path
    // model but are separate `return` statements, so "insert after [0]" has no
    // meaning at all.
    const src = `function C({x}) { if (x) return <a/>; return <b/>; }`;
    for (const tag of ['a', 'b']) {
      const r = selfResolve(src, tag, { requireStatic: true });
      expect(r.located).toBe(false);
      expect(r.reason).toMatch(/whole return value/);
    }
  });

  it('still allows ATTRIBUTE edits on a top-level returned element', () => {
    // The refusal is scoped to structural ops. Without requireStatic the same
    // node resolves normally — a class or prop edit never splices a sibling.
    const r = selfResolve(`function C() { return <div/>; }`, 'div');
    expect(r.located).toBe(true);
    expect(r.entry.tag).toBe('div');
  });
});

// --- role: what the anchor IS to the caller's op ---------------------------

describe("resolveNode role: 'container'", () => {
  // Two of the three guards are about splicing THIS node into or out of a
  // sibling list. When it only RECEIVES a child, neither hazard exists. Checked
  // against the parser before these were written: a child spliced into a
  // returned root parses, a child spliced into a conditionally-rendered element
  // parses, and a SIBLING beside a returned root is a syntax error.

  it('admits a top-level returned element as a container', () => {
    // The op this unblocks is "insert into the page's root <div>" — and, more
    // sharply, the INVERSE of a remove. Without it a remove inside the root
    // succeeds and cannot be undone: data loss, not a missing capability.
    const src = `function C() { return <div><A/></div>; }`;
    expect(selfResolve(src, 'div', { requireStatic: true }).located).toBe(false);
    expect(selfResolve(src, 'div', { requireStatic: true, role: 'container' }).located).toBe(true);
  });

  it('admits a conditionally-rendered element as a container', () => {
    // `{cond && <div/>}` cannot be spliced as a sibling (removing it leaves a
    // bare `{}`), but a child lands inside its own children region.
    const src = `function C() { return <p>{cond && <div/>}</p>; }`;
    expect(selfResolve(src, 'div', { requireStatic: true }).located).toBe(false);
    expect(selfResolve(src, 'div', { requireStatic: true, role: 'container' }).located).toBe(true);
  });

  it('still refuses a non-static scope as a container', () => {
    // The one guard that survives the role: a `.map()` body renders N times
    // whether you are moving it or filling it, so the splice is undefined
    // either way.
    const src = `function C() { return <ul>{items.map(d => <li/>)}</ul>; }`;
    const r = selfResolve(src, 'li', { requireStatic: true, role: 'container' });
    expect(r.located).toBe(false);
    expect(r.scope).toBe('iteration');
  });

  it("defaults to 'target', so every existing caller is unchanged", () => {
    // Guards the guard: the widening must not have relaxed the default. If it
    // had, a remove of a whole return value would start succeeding.
    const src = `function C() { return <div/>; }`;
    expect(selfResolve(src, 'div', { requireStatic: true }).located).toBe(false);
    expect(selfResolve(src, 'div', { requireStatic: true, role: 'target' }).located).toBe(false);
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

// --- THE ANCHOR-STABILITY GUARD --------------------------------------------

describe('fp/fpx are frozen values, not incidental ones', () => {
  /**
   * HARDCODED HASHES, ON PURPOSE. An anchor is `{path, tag, fp, fpx}` and it is
   * STORED — in a pending edit, in a transaction log, in a client that has not
   * reloaded. So `fp` and `fpx` are a wire format: any change to the bytes hashed
   * into them silently invalidates every anchor already written down, and the
   * failure surfaces later as "your edit could not be located" with no pointer
   * back to the commit that caused it.
   *
   * The values below were captured by running this fixture set against
   * `4ccbd8656` — before `classNameExpr` existed. They are what makes the
   * ADDITIVE claim checkable rather than asserted: the new field is read out of
   * the same `attrsOf` call that feeds `fpOf`, and one extra name in that
   * destructure reaching the hash payload would change all 40 lines here.
   *
   * A deliberate change to the fingerprint scheme SHOULD fail this test. Re-record
   * it in the same commit and say so — that is the point, not an obstacle.
   */
  const FROZEN = {
    // The four editable-blob shapes are byte-identical under BOTH hashes: `fp`
    // excludes class content, and `fpx` sees the same resolved tokens whether
    // they were written bare, braced, templated, or inside `cn()`. Rewriting
    // `className="p-2 flex"` as `className={cn("p-2 flex", x)}` therefore keeps
    // every stored anchor valid.
    'plain literal': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f eb23554e', '0.0 b 3ffb9405 e0ba70ef'],
    'braced literal': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f eb23554e', '0.0 b 3ffb9405 e0ba70ef'],
    'template literal': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f eb23554e', '0.0 b 3ffb9405 e0ba70ef'],
    'cn joiner': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f eb23554e', '0.0 b 3ffb9405 e0ba70ef'],
    // No attributable blob: same `fp` as above (the attribute NAME is present
    // either way), and an `fpx` computed over no class tokens.
    'non-joiner call': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f cbb1aa6c', '0.0 b 3ffb9405 e0ba70ef'],
    'bare identifier': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f cbb1aa6c', '0.0 b 3ffb9405 e0ba70ef'],
    'bare attribute': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f cbb1aa6c', '0.0 b 3ffb9405 e0ba70ef'],
    'empty braces': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f cbb1aa6c', '0.0 b 3ffb9405 e0ba70ef'],
    // Dropping the attribute changes `fp` itself — `attrNames` is hashed.
    'no className': ['- #returns 5df8fdfc 3e22f841', '0 div c971b93e 798d1169', '0.0 b 3ffb9405 e0ba70ef'],
    'duplicate className': ['- #returns 5df8fdfc 3e22f841', '0 div f62d6d74 28229f9d', '0.0 b 2346673c c8f36efe'],
    'nested + map': ['- #returns 5df8fdfc f2730f1e', '0 ul 34d82812 d3d1b984', '0.0 li 3a273f92 c59ad441'],
    'conditional child': ['- #returns 5df8fdfc 3e22f841', '0 div 0184d92f 9d897f27', '0.0 span 071ab0b6 8005e494'],
    'fragment root': ['- #returns 5df8fdfc edc70add', '0 a 2bd338bc d4de0aeb', '1 a 2bd338bc a6b342e3'],
    'two returns': ['- #returns 5df8fdfc b3843468', '0 p 60d8f3cc 90b4e389', '1 div 0184d92f ba09822a'],
    'identity attrs': ['- #returns 5df8fdfc edc9ad7f', '0 a 90203349 0b8baba4'],
    spread: ['- #returns 5df8fdfc 3e22f841', '0 div b52c06f9 f84c56dc'],
  };

  const FIXTURES = {
    'plain literal': `function C(){ return <div className="p-2 flex"><b id="x">hi</b></div>; }`,
    'braced literal': `function C(){ return <div className={"p-2 flex"}><b id="x">hi</b></div>; }`,
    'template literal': 'function C(){ return <div className={`p-2 flex`}><b id="x">hi</b></div>; }',
    'cn joiner': `function C(){ return <div className={cn("p-2 flex", other)}><b id="x">hi</b></div>; }`,
    'non-joiner call': `function C(){ return <div className={t("nav.home")}><b id="x">hi</b></div>; }`,
    'bare identifier': `function C(){ return <div className={other}><b id="x">hi</b></div>; }`,
    'bare attribute': `function C(){ return <div className><b id="x">hi</b></div>; }`,
    'empty braces': `function C(){ return <div className={}><b id="x">hi</b></div>; }`,
    'no className': `function C(){ return <div><b id="x">hi</b></div>; }`,
    'duplicate className': `function C(){ return <div className={t("x")} className="p-2"><b/></div>; }`,
    'nested + map': `function C(){ return <ul className="list">{items.map(d => <li className={cn("row", d.x)}>{d.n}</li>)}</ul>; }`,
    'conditional child': `function C(){ return <div className="a">{open && <span className={styles.x}>x</span>}</div>; }`,
    'fragment root': `function C(){ return <><a className="one"/><a className="two"/></>; }`,
    'two returns': `function C(){ if (x) return <p className="early"/>; return <div className="late"/>; }`,
    'identity attrs': `function C(){ return <a href="/x" role="link" aria-label="Go" className="u">Go</a>; }`,
    spread: `function C(){ return <div {...rest} className="s"/>; }`,
  };

  for (const [name, src] of Object.entries(FIXTURES)) {
    it(`is unchanged for: ${name}`, () => {
      const lines = entriesOf(src).map(
        (e) => `${e.path.join('.') || '-'} ${e.tag} ${e.fp} ${e.fpx}`,
      );
      expect(lines).toEqual(FROZEN[name]);
    });
  }

  it('covers every fixture, so a dropped row cannot pass silently', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(FROZEN).sort());
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
    // ISOLATES THE FPX STEP. The two `<p>` share an fp — same tag, same
    // attribute NAMES, and fp excludes className CONTENT — so the fp search
    // finds two and refuses. Only fpx, which restores the class content, can
    // resolve this. A fixture whose node is unique under fp too would pass
    // identically with the whole fpx branch deleted.
    const twin = `function C(){ return <div><p className="one"/><p className="two"/></div>; }`;
    const sf = parse(twin);
    const entries = [...walkJsx(sf, findJsxRoots(sf).roots.C)];
    const e = entries.find((x) => x.tag === 'p' && x.path.at(-1) === 1);
    // The premise, asserted rather than assumed: if fp ever stopped colliding
    // here the test would silently stop testing fpx.
    expect(entries.filter((x) => x.fp === e.fp)).toHaveLength(2);
    expect(entries.filter((x) => x.fpx === e.fpx)).toHaveLength(1);

    const r = resolveNode(sf, { component: 'C', path: [9, 9], tag: 'p', fp: e.fp, fpx: e.fpx });
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

  it('does NOT trust a path hint whose tag disagrees, even when the fp matches', () => {
    // ISOLATES THE TAG GUARD, which is otherwise unreachable: `fpOf` hashes the
    // tag, so a self-consistent anchor can never have a matching fp AND a wrong
    // tag. Only a client whose record has drifted can, which is exactly what the
    // guard is for. The observable is `relocated`, not `located` — with the
    // guard the hint is rejected and the node is re-found by search; without it
    // the hint is taken as-is and `relocated` comes back false.
    const sf = parse(src);
    const e = [...walkJsx(sf, findJsxRoots(sf).roots.C)].find((x) => x.tag === 'b');
    const r = resolveNode(sf, { component: 'C', path: e.path, tag: 'span', fp: e.fp });
    expect(r.located).toBe(true);
    expect(r.relocated).toBe(true);
    expect(r.entry.tag).toBe('b');
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

  it('reports an Object.prototype key as a missing component, not a stale anchor', () => {
    // `anchor.component` arrives from the client, so it is not constrained to
    // names present in the file. On a plain `{}`, `roots['toString']` returned
    // the inherited METHOD — truthy, so the `!root` guard passed and the walk
    // ran against a function. It happened not to throw, and instead blamed the
    // user's anchor for going stale when the real answer was "no such
    // component". Diagnosing the wrong thing is how an hour disappears.
    for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      const r = resolveNode(parse(src), { component: name, path: [0], tag: 'b', fp: 'deadbeef' });
      expect(r.located).toBe(false);
      expect(r.reason).toBe(`no JSX-returning function named ${name}`);
    }
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

  it('sees through forwardRef and memo to the component inside', () => {
    // Without the unwrap none of these register at ALL, and a root that does
    // not exist is a component whose every node is unstamped and unaddressable
    // — a click inside it lands on an ancestor. shadcn/Radix code, which the
    // support matrix is built around, declares components this way constantly.
    const { roots } = findJsxRoots(parse(`
      const A = forwardRef((props, ref) => <button ref={ref}/>);
      const B = React.memo(function Inner() { return <li/>; });
      const C = memo(forwardRef((props, ref) => <td/>));`));
    expect(Object.keys(roots).sort()).toEqual(['A', 'B', 'C']);
  });

  it('does not treat any other call holding an arrow as a component', () => {
    // The premise: an arrow returning JSX inside a call is not by itself a
    // component — `useMemo`'s is a memo body. Keying a root on `X` for JSX that
    // is not `X`'s render output would put a wrong name in the outline.
    const { roots } = findJsxRoots(parse(`
      const X = useMemo(() => <div/>, []);
      const Y = withRetry(() => <Spinner/>);`));
    expect(Object.keys(roots)).toEqual([]);
  });

  it('registers an anonymous default export under `default`', () => {
    for (const src of [
      `export default function () { return <div/>; }`,
      `export default () => <div/>;`,
      `export default memo(() => <div/>);`,
    ]) {
      const { roots, defaultExport } = findJsxRoots(parse(src));
      expect(Object.keys(roots)).toEqual(['default']);
      expect(defaultExport).toBe('default');
    }
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

  it('registers components whose names collide with Object.prototype', () => {
    // `roots` is keyed by arbitrary source identifiers. On a plain `{}` these
    // three names each broke it differently: `'toString' in roots` is true on
    // FIRST sight, so the component was reported ambiguous and became
    // permanently unresolvable; and `roots.__proto__ = root` hit the inherited
    // accessor instead of defining a key, so that root vanished from
    // `Object.keys` AND repointed the map's prototype.
    for (const name of ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__']) {
      const { roots, ambiguous } = findJsxRoots(parse(`function ${name}() { return <div/>; }`));
      expect(Object.keys(roots)).toEqual([name]);
      expect([...ambiguous]).toEqual([]);
    }
  });

  it('keeps the roots map free of any inherited prototype', () => {
    expect(Object.getPrototypeOf(findJsxRoots(parse(`const __proto__ = () => <div/>;`)).roots))
      .toBeNull();
  });

  it('still detects genuine duplicates after the prototype fix', () => {
    // Guards the guard: `Object.create(null)` must not have been achieved by
    // weakening the `name in roots` check that ambiguity detection rests on.
    const { ambiguous } = findJsxRoots(parse(`
      function Row() { return <li/>; }
      function A() { const Row = () => <b/>; return <div/>; }`));
    expect([...ambiguous]).toEqual(['Row']);
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
    expect(attrsOf(root.node)).toEqual({
      names: [],
      identity: {},
      className: null,
      classNameExpr: null,
    });
  });
});

// --- the className / classNameExpr pair ------------------------------------

describe('attrsOf classNameExpr', () => {
  /** `[className, classNameExpr]` for the `<div>` in `src`. */
  const pairOf = (src) => {
    const { className, classNameExpr } = attrsOf(find(src, 'div').node);
    return [className, classNameExpr];
  };

  /**
   * `classLiteralOf` refuses to name a rewrite target it cannot attribute, which
   * is correct and — before this field — INVISIBLE: `className={t("nav.home")}`
   * reached the UI as `className: null`, indistinguishable from a node with no
   * class attribute at all, so the editor offered an edit `applyClassRewrite`
   * then refused. `classNameExpr` carries the text to show instead.
   *
   * The pair is a 2x2, and the tests below walk all four corners. Only ONE of
   * them is locked; the trap this guards is reading `classNameExpr !== null` as
   * "locked" and greying out the editable `cn("p-2", x)` blob.
   */
  it('is null for a plain literal — nothing is withheld', () => {
    expect(pairOf(`function C(){ return <div className="p-2 flex"/>; }`)).toEqual(['p-2 flex', null]);
  });

  it('is null for a BRACED literal, which reads identically to the unbraced form', () => {
    // The braces are the author's punctuation, not a restriction: `classLiteralOf`
    // returns the same literal, so a read-only token here would claim there is
    // something the designer cannot edit when there is not.
    expect(pairOf(`function C(){ return <div className={"p-2 flex"}/>; }`)).toEqual(['p-2 flex', null]);
    expect(pairOf('function C(){ return <div className={`p-2 flex`}/>; }')).toEqual(['p-2 flex', null]);
    expect(pairOf(`function C(){ return <div className={("p-2 flex")}/>; }`)).toEqual(['p-2 flex', null]);
  });

  it('fills BOTH fields for a joiner call — an editable blob inside an expression', () => {
    // NOT locked. The literal is a live rewrite target; the rest is the author's.
    expect(pairOf(`function C(){ return <div className={cn("p-2", x)}/>; }`))
      .toEqual(['p-2', 'cn("p-2", x)']);
    expect(pairOf(`function C(){ return <div className={utils.cn("p-2")}/>; }`))
      .toEqual(['p-2', 'utils.cn("p-2")']);
  });

  it('LOCKED: an expression with no attributable blob', () => {
    // Each of these is refused by `applyClassRewrite`; each now has text to show.
    expect(pairOf(`function C(){ return <div className={t("nav.home")}/>; }`))
      .toEqual([null, 't("nav.home")']);
    expect(pairOf(`function C(){ return <div className={styles.row}/>; }`))
      .toEqual([null, 'styles.row']);
    expect(pairOf(`function C(){ return <div className={a ? "yes" : "no"}/>; }`))
      .toEqual([null, 'a ? "yes" : "no"']);
    expect(pairOf('function C(){ return <div className={`p-2 ${x}`}/>; }'))
      .toEqual([null, '`p-2 ${x}`']);
    expect(pairOf(`function C(){ return <div className={cn(button({size:"sm"}))}/>; }`))
      .toEqual([null, 'cn(button({size:"sm"}))']);
  });

  it('is null with no className attribute at all', () => {
    expect(pairOf(`function C(){ return <div id="x"/>; }`)).toEqual([null, null]);
  });

  it('reads the FIRST className when an invalid duplicate is present', () => {
    // A duplicate `className` is a TYPE error, not a parse error, so it reaches
    // `attrsOf` intact. `classLiteralOf` answers for the first attribute; taking
    // the expression from a later one would pair one attribute's literal with
    // another's expression and describe a node that does not exist. Both orders,
    // because only one of them is wrong in the dangerous direction.
    expect(pairOf(`function C(){ return <div className="p-2" className={t("x")}/>; }`))
      .toEqual(['p-2', null]);
    expect(pairOf(`function C(){ return <div className={t("x")} className="p-2"/>; }`))
      .toEqual([null, 't("x")']);
  });

  it('does NOT distinguish a valueless className from no className', () => {
    // The documented hole in the pair, asserted so it stays a known shape rather
    // than a surprise: both are `[null, null]`, which row 4 of the contract reads
    // as "no attribute" — yet `applyClassRewrite` refuses them, since its test is
    // `findJsxAttribute && !classLiteralOf`. `names` is what separates them, so a
    // UI mirroring the refusal must test that instead.
    for (const src of [
      `function C(){ return <div className/>; }`,
      `function C(){ return <div className={}/>; }`,
    ]) {
      expect(pairOf(src)).toEqual([null, null]);
      expect(attrsOf(find(src, 'div').node).names).toContain('className');
    }
  });

  it('returns the expression VERBATIM, newlines included', () => {
    // Source text, not a display string. A UI rendering a single-line token has
    // to collapse it; nothing downstream does that for it.
    const src = `function C(){ return <div className={cn(\n  "p-2",\n  other,\n)}/>; }`;
    expect(pairOf(src)).toEqual(['p-2', 'cn(\n  "p-2",\n  other,\n)']);
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

  it('takes the first DIRECT string argument of a cn() call', () => {
    expect(classOf(`function C(){ return <div className={cn("a b", other && "c")}/>; }`)).toBe('a b');
    expect(classOf(`function C(){ return <div className={cn(("a b"))}/>; }`)).toBe('a b');
  });

  it('skips non-literal arguments to reach the authored blob', () => {
    // Each of these has an earlier string literal NESTED inside an argument.
    // Descending would return that one — an object key, a ternary branch, or a
    // CVA variant value — and inject.mjs would rewrite it as if it were classes.
    expect(classOf(`function C(){ return <div className={cn({"is-open": open}, "base")}/>; }`))
      .toBe('base');
    expect(classOf(`function C(){ return <div className={clsx(a ? "yes" : "no", "base")}/>; }`))
      .toBe('base');
    expect(classOf(`function C(){ return <div className={cn(button({size:"sm"}), "base")}/>; }`))
      .toBe('base');
    expect(classOf(`function C(){ return <div className={cn(styles.x, "base")}/>; }`)).toBe('base');
  });

  it('reads a joiner reached through a namespace import', () => {
    expect(classOf(`function C(){ return <div className={utils.cn("a b")}/>; }`)).toBe('a b');
  });

  it('ignores a call that is NOT a known class joiner', () => {
    // The premise: these have a direct string argument, so only the callee name
    // separates them from the `cn("a b")` case above.
    //
    // It matters because inject.mjs REWRITES this literal in place. Returning
    // it here turns `className={t("nav.home")}` into `className={t("flex")}`
    // and destroys the translation key — a silent wrong write, whereas null
    // costs a search key and produces a visible refusal.
    expect(classOf(`function C(){ return <div className={t("nav.home")}/>; }`)).toBeNull();
    expect(classOf(`function C(){ return <div className={variantFor("primary")}/>; }`)).toBeNull();
  });

  it('returns null when there is no literal to edit', () => {
    expect(classOf(`function C(){ return <div className={other}/>; }`)).toBeNull();
    expect(classOf(`function C(){ return <div id="x"/>; }`)).toBeNull();
  });

  it('returns null rather than guessing when NO argument is a direct literal', () => {
    // Refusing costs the class signal in fpx. Guessing would point a rewrite at
    // a variant value or an object key.
    expect(classOf(`function C(){ return <div className={cn(button({size:"sm"}))}/>; }`)).toBeNull();
    expect(classOf(`function C(){ return <div className={a ? "yes" : "no"}/>; }`)).toBeNull();
    expect(classOf('function C(){ return <div className={`p-2 ${x}`}/>; }')).toBeNull();
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
