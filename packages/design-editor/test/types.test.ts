import { describe, expect, it } from 'vitest';
import {
  antiPatternList,
  sceneNodeAt,
  walkSceneNodes,
  type Analysis,
  type SceneNodeMeta,
} from '../src/types';

/**
 * `sceneNodeAt` is the CLIENT half of the index-path addressing that
 * `jsx-nodes.mjs` defines on the server. The engine spec is explicit that two
 * implementations of that numbering would drift, and that the drift surfaces as
 * an edit landing on the wrong node — silently. The server side gets its own
 * tests when it lands; this file pins the client side's contract so the two can
 * be compared rather than assumed equal.
 */

function node(tag: string, children: SceneNodeMeta[] = []): SceneNodeMeta {
  return {
    path: [],
    tag,
    attrs: [],
    className: null,
    identity: {},
    text: null,
    fp: `fp:${tag}`,
    fpx: `fpx:${tag}`,
    analysis: emptyAnalysis(),
    scope: 'static',
    structuralEditable: true,
    repeated: false,
    clickSelectable: true,
    children,
  };
}

function emptyAnalysis(): Analysis {
  return {
    tokensUsed: [],
    colorBindings: [],
    scaleBindings: [],
    antiPatterns: {
      hardcodedPaletteColors: [],
      hardcodedNamedColors: [],
      hexLiterals: [],
      rgbHslLiterals: [],
      arbitraryPx: [],
    },
  };
}

/**
 *   root
 *   ├── header
 *   │   └── title
 *   ├── main
 *   │   ├── card
 *   │   └── list
 *   └── footer
 */
const tree = node('#returns', [
  node('header', [node('title')]),
  node('main', [node('card'), node('list')]),
  node('footer'),
]);

describe('sceneNodeAt', () => {
  it('returns the root for an empty path', () => {
    // The root IS addressable — the outline's breadcrumb resolves to `[]`.
    expect(sceneNodeAt(tree, [])?.tag).toBe('#returns');
  });

  it('walks child indices in order', () => {
    expect(sceneNodeAt(tree, [0])?.tag).toBe('header');
    expect(sceneNodeAt(tree, [1])?.tag).toBe('main');
    expect(sceneNodeAt(tree, [2])?.tag).toBe('footer');
    expect(sceneNodeAt(tree, [0, 0])?.tag).toBe('title');
    expect(sceneNodeAt(tree, [1, 1])?.tag).toBe('list');
  });

  it('returns null rather than throwing when the path runs past a leaf', () => {
    // A staged edit's anchor can outlive the tree it pointed into (the file was
    // edited elsewhere, the scene re-extracted). Resolution must fail closed —
    // the caller then rebases via `fp`, which is the identity.
    expect(sceneNodeAt(tree, [9])).toBeNull();
    expect(sceneNodeAt(tree, [0, 0, 0])).toBeNull();
    expect(sceneNodeAt(tree, [2, 0])).toBeNull();
  });

  it('returns null for a negative index instead of wrapping', () => {
    // `children[-1]` is `undefined` in JS, not the last element. Pinned because
    // an off-by-one in a caller must surface as "not found", never as a
    // silently-resolved DIFFERENT node.
    expect(sceneNodeAt(tree, [-1])).toBeNull();
  });

  it('does not mutate the tree it reads', () => {
    const before = JSON.stringify(tree);
    sceneNodeAt(tree, [1, 0]);
    sceneNodeAt(tree, [9, 9]);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('walkSceneNodes', () => {
  it('visits every node depth-first, parents before children', () => {
    const seen: string[] = [];
    walkSceneNodes(tree, (n) => seen.push(n.tag));
    expect(seen).toEqual(['#returns', 'header', 'title', 'main', 'card', 'list', 'footer']);
  });

  it('visits a childless root exactly once', () => {
    const seen: string[] = [];
    walkSceneNodes(node('div'), (n) => seen.push(n.tag));
    expect(seen).toEqual(['div']);
  });

  it('agrees with sceneNodeAt about which nodes exist', () => {
    // The outline renders from `walkSceneNodes` and selects through
    // `sceneNodeAt`. If one can reach a node the other cannot, a visible row
    // becomes unselectable.
    const paths: number[][] = [];
    const collect = (n: SceneNodeMeta, path: number[]) => {
      paths.push(path);
      n.children.forEach((c, i) => collect(c, [...path, i]));
    };
    collect(tree, []);

    let visited = 0;
    walkSceneNodes(tree, () => visited++);

    expect(paths.length).toBe(visited);
    for (const p of paths) expect(sceneNodeAt(tree, p)).not.toBeNull();
  });
});

describe('antiPatternList', () => {
  it('flattens every anti-pattern bucket in a stable order', () => {
    const a = emptyAnalysis();
    a.antiPatterns.hardcodedPaletteColors = ['bg-syrup'];
    a.antiPatterns.hardcodedNamedColors = ['text-red-500'];
    a.antiPatterns.hexLiterals = ['#fff'];
    a.antiPatterns.rgbHslLiterals = ['rgb(0 0 0)'];
    a.antiPatterns.arbitraryPx = ['w-[13px]'];

    expect(antiPatternList(a)).toEqual([
      'bg-syrup',
      'text-red-500',
      '#fff',
      'rgb(0 0 0)',
      'w-[13px]',
    ]);
  });

  it('is empty for a clean analysis', () => {
    expect(antiPatternList(emptyAnalysis())).toEqual([]);
  });

  it('keeps duplicates across buckets', () => {
    // The count is a badge in the UI; de-duplicating here would under-report a
    // class flagged by two different rules.
    const a = emptyAnalysis();
    a.antiPatterns.hexLiterals = ['#fff'];
    a.antiPatterns.hardcodedNamedColors = ['#fff'];
    expect(antiPatternList(a)).toHaveLength(2);
  });
});
