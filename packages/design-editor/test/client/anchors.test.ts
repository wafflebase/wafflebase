import { describe, expect, it } from 'vitest';
import {
  anchorFromStamp,
  planRebase,
  resolveAnchor,
  rootsLookup,
  type RootsHolder,
} from '../../src/client/anchors.ts';
import type { SceneMeta, SceneNodeMeta } from '../../src/types.ts';
import type { NodeAnchor } from '../../src/plugin/protocol.ts';

/**
 * Client-side anchor resolution — the mirror of `jsx-nodes.mjs#resolveNode`.
 *
 * THE RULE UNDER TEST IS "AMBIGUITY IS ABSENCE". Every search step resolves only on
 * exactly one match, because picking the first of two identical `<span>·</span>` nodes
 * would re-point an edit at the wrong one and write there with no visible symptom. That is
 * the worst failure this tool has, and it is a failure no test of the happy path can see.
 *
 * The second rule is `planRebase`'s: UNKNOWN IS NOT LOST. An anchor whose file has no
 * cached tree is skipped, not marked stale — marking it would be a guess dressed as a
 * verdict, and it costs the user their staged work when it is wrong.
 */

/** Minimal `SceneNodeMeta`; only the fields resolution reads are set. */
function node(
  tag: string,
  path: number[],
  fp: string,
  over: Partial<SceneNodeMeta> = {},
): SceneNodeMeta {
  return {
    tag,
    path,
    fp,
    fpx: over.fpx ?? `${fp}x`,
    children: over.children ?? [],
    scope: over.scope ?? 'static',
    structuralEditable: over.structuralEditable ?? true,
    className: over.className ?? null,
    repeated: over.repeated ?? false,
    analysis: over.analysis ?? ({} as SceneNodeMeta['analysis']),
    ...over,
  } as SceneNodeMeta;
}

/** `<main>` with two identical `<span>`s and one distinct `<b>`. */
function holder(): RootsHolder {
  // Same `fp`, different `fpx`: real, because `fp` excludes classes and the child tag
  // sequence while `fpx` includes both. This pair is the whole point of step 2.
  const spanA = node('span', [0, 0], 'dup', { fpx: 'dupA' });
  const spanB = node('span', [0, 1], 'dup', { fpx: 'dupB' });
  const b = node('b', [0, 2], 'uniq');
  const main = node('main', [0], 'mainfp', { children: [spanA, spanB, b] });
  return { roots: { Page: node('#returns', [], 'rootfp', { children: [main] }) } };
}

const anchorOf = (over: Partial<NodeAnchor> = {}): NodeAnchor => ({
  file: 'app/a.tsx',
  component: 'Page',
  path: [0],
  tag: 'main',
  fp: 'mainfp',
  ...over,
});

describe('resolveAnchor', () => {
  it('takes the path hint when tag and fp agree', () => {
    const r = resolveAnchor(holder(), anchorOf());
    expect(r.path).toEqual([0]);
    expect(r.relocated).toBe(false);
    expect(r.node?.tag).toBe('main');
  });

  it('rejects a path hint that lands on a DIFFERENT REAL node', () => {
    // The case that matters, and the one an out-of-range path cannot expose: a
    // `layout-insert` into `<main>` renumbers every following sibling, so a stale path
    // still resolves — to the wrong node. Unverified, the hint returns `<span>` at [0,0]
    // and the edit is written there. Verified by tag + fp, it falls through and relocates.
    const r = resolveAnchor(holder(), anchorOf({ path: [0, 0], tag: 'b', fp: 'uniq', fpx: 'uniqx' }));
    expect(r.path).toEqual([0, 2]);
    expect(r.node?.tag).toBe('b');
    expect(r.relocated).toBe(true);
  });

  it('relocates when the path no longer exists at all', () => {
    const r = resolveAnchor(holder(), anchorOf({ path: [9, 9], tag: 'b', fp: 'uniq' }));
    expect(r.path).toEqual([0, 2]);
    expect(r.relocated).toBe(true);
  });

  it('resolves via the high-precision fpx where the plain fp is ambiguous', () => {
    // Step 2 is the only thing that turns an ambiguous pair into a resolution: `fp` alone
    // matches both spans, `fpx` adds classes and the child-tag sequence and separates them.
    const r = resolveAnchor(holder(), anchorOf({ path: [9], tag: 'span', fp: 'dup', fpx: 'dupB' }));
    expect(r.path).toEqual([0, 1]);
    expect(r.relocated).toBe(true);
  });

  it('REFUSES when two nodes share the fingerprint, and lists them', () => {
    // Guessing here writes to the wrong node with no visible symptom.
    const r = resolveAnchor(holder(), anchorOf({ path: [9], tag: 'span', fp: 'dup' }));
    expect(r.path).toBeUndefined();
    expect(r.node).toBeUndefined();
    expect(r.candidates).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(r.reason).toMatch(/2 candidates/);
  });

  it('reports a missing root by name rather than resolving nothing', () => {
    const r = resolveAnchor(holder(), anchorOf({ component: 'Nope' }));
    expect(r.reason).toMatch(/no JSX-returning function named Nope/);
  });

  it('reports zero candidates when the fingerprint is gone entirely', () => {
    const r = resolveAnchor(holder(), anchorOf({ path: [9], tag: 'i', fp: 'vanished' }));
    expect(r.candidates).toEqual([]);
    expect(r.reason).toMatch(/0 candidates/);
  });
});

describe('anchorFromStamp — a click in the frame becomes a baseline anchor', () => {
  const stamp = (over: Partial<{ component: string; path: number[]; fp: string; tag: string }> = {}) => ({
    component: 'Page',
    path: [0],
    fp: 'mainfp',
    tag: 'main',
    ...over,
  });

  it('resolves, and carries the fpx the DOM stamp does not have', () => {
    // The stamp cannot supply `fpx`, so resolution fills it from the tree — which is what
    // lets a LATER rebase use the high-precision step.
    const r = anchorFromStamp(holder(), 'app/a.tsx', stamp());
    expect(r.anchor).toMatchObject({ file: 'app/a.tsx', component: 'Page', path: [0], fpx: 'mainfpx' });
    expect(r.created).toBeUndefined();
  });

  it('refuses an ambiguous click instead of picking one', () => {
    const r = anchorFromStamp(holder(), 'app/a.tsx', stamp({ tag: 'span', fp: 'dup', path: [9] }));
    expect(r.anchor).toBeUndefined();
    expect(r.candidates).toHaveLength(2);
  });

  it('reports `created` for a node the staged insert produced', () => {
    // NOT a failure. The frame is served with the plan applied, so a node with no
    // counterpart on disk is one this session inserted — edited through the parent
    // insert's payload, never as its own edit.
    const r = anchorFromStamp(holder(), 'app/a.tsx', stamp({ tag: 'em', fp: 'brandnew', path: [7] }));
    expect(r.created).toBe(true);
    expect(r.reason).toMatch(/created by a staged insert/);
    expect(r.anchor).toBeUndefined();
  });

  it('names the file when the root is missing, because the click came from somewhere', () => {
    const r = anchorFromStamp(holder(), 'app/a.tsx', stamp({ component: 'Gone' }));
    expect(r.reason).toMatch(/no JSX-returning function named Gone in app\/a\.tsx/);
  });
});

describe('rootsLookup', () => {
  const scene = (id: string, file: string): SceneMeta =>
    ({ id, file, roots: holder().roots }) as unknown as SceneMeta;

  it('prefers the anchor’s own file, because that is where the write lands', () => {
    const drilled: RootsHolder = { roots: {} };
    const look = rootsLookup([scene('s', 'app/page.tsx')], { 'app/list.tsx': drilled });
    expect(look(anchorOf({ file: 'app/list.tsx' }), 's')).toBe(drilled);
  });

  it('falls back to a scene only when the scene IS that file', () => {
    // The drill-in is why: an edit made inside `<DocumentList/>` is anchored in
    // `document-list.tsx` while the scene is `documents/page.tsx`. Resolving it against
    // the scene's roots looks up a root in a different file, fails, and reports the edit
    // LOST — so every drill-in edit would go stale on the first refresh.
    const s = scene('s', 'app/page.tsx');
    const look = rootsLookup([s]);
    expect(look(anchorOf({ file: 'app/page.tsx' }), 's')).toBe(s);
    expect(look(anchorOf({ file: 'app/list.tsx' }), 's')).toBeNull();
  });
});

describe('planRebase', () => {
  const layout = (anchor: NodeAnchor, over: Record<string, unknown> = {}) => ({
    e1: { anchor, sceneId: 's', ...over },
  });

  it('emits nothing when every anchor still resolves where it was', () => {
    const look = rootsLookup([], { 'app/a.tsx': holder() });
    expect(planRebase(layout(anchorOf({ fpx: 'mainfpx' })), look)).toEqual([]);
  });

  it('rewrites a path when the node moved', () => {
    const look = rootsLookup([], { 'app/a.tsx': holder() });
    const out = planRebase(layout(anchorOf({ path: [9, 9], tag: 'b', fp: 'uniq', fpx: 'uniqx' })), look);
    expect(out).toEqual([{ map: 'layoutEdits', key: 'e1', field: 'anchor', path: [0, 2], fpx: 'uniqx' }]);
  });

  it('marks an anchor lost when its file IS known and it no longer resolves', () => {
    const look = rootsLookup([], { 'app/a.tsx': holder() });
    const out = planRebase(layout(anchorOf({ path: [9], tag: 'i', fp: 'vanished' })), look);
    expect(out[0]).toMatchObject({ key: 'e1', field: 'anchor', lost: true });
    expect(out[0].reason).toMatch(/no longer resolves/);
  });

  it('SKIPS an anchor whose file has no tree — unknown is not lost', () => {
    // Marking it would be a guess dressed as a verdict: the file is almost certainly fine
    // and simply not cached, and "this edit can no longer be applied" costs the user their
    // work when it is wrong. A genuinely dead anchor still fails at save time, where the
    // error comes from the server that actually tried it.
    const look = rootsLookup([], {});
    expect(planRebase(layout(anchorOf({ path: [9], tag: 'i', fp: 'vanished' })), look)).toEqual([]);
  });

  it('rebases `toParent` as well as `anchor`', () => {
    // A move has two anchors and both renumber; rebasing only one leaves the edit writing
    // to a stale destination.
    const look = rootsLookup([], { 'app/a.tsx': holder() });
    const out = planRebase(
      layout(anchorOf({ fpx: 'mainfpx' }), {
        toParent: anchorOf({ path: [9, 9], tag: 'b', fp: 'uniq', fpx: 'uniqx' }),
      }),
      look,
    );
    expect(out.map((o) => o.field)).toEqual(['toParent']);
  });
});
