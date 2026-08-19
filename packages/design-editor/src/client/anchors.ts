import type { SceneMeta, SceneNodeMeta } from '../types.ts';
import type { EditRef } from './edits.ts';
/**
 * `NodeAnchor` comes from the WIRE PROTOCOL, not from a client-side copy.
 *
 * The prototype declared it in `sandbox/mutate.ts` — the client's own bridge module — so
 * the client and the server each had their own idea of what a write targets. 9a moved the
 * intent types to `plugin/protocol.ts` and had the client import them, for exactly the
 * reason this file matters: an anchor the two sides disagree about is a write to the wrong
 * node with no visible symptom.
 */
import type { NodeAnchor } from '../plugin/protocol.ts';

/**
 * Client-side anchor resolution — the mirror of `jsx-nodes.mjs#resolveNode`.
 *
 * WHY A MIRROR RATHER THAN AN ENDPOINT. After every write the metadata is
 * regenerated, and a `layout-insert` renumbers every following sibling. If the
 * client kept its pre-write paths, the NEXT save would fail on all of them — so
 * the paths have to be rewritten the moment fresh metadata arrives, which means
 * resolving against the tree the client already holds. Asking the bridge per
 * staged edit would be a round-trip per edit on every refresh.
 *
 * The server keeps the authoritative copy: this one only moves coordinates,
 * never decides whether a write is legal. A disagreement therefore costs a
 * `located: false` at save time (which the stale/discard path already handles),
 * not a wrong write.
 *
 * The steps match the server exactly, most precise first:
 *   1. the `path` hint, verified by `tag` + `fp`
 *   2. a unique `fpx` match  (high precision: + classes + child tags)
 *   3. a unique `fp` match   (low precision, survives edits to this node)
 * Every search step resolves ONLY on exactly one match — ambiguity is treated as
 * absence, because picking the first of two identical siblings would silently
 * re-point an edit at the wrong node.
 */

export interface AnchorResolution {
  /** The node, when resolution succeeded. */
  node?: SceneNodeMeta;
  /** The path to write back into the anchor. */
  path?: number[];
  /** True when step 2 or 3 found it somewhere else. */
  relocated?: boolean;
  /** Candidate paths when the search was ambiguous — feeds "re-point this edit". */
  candidates?: number[][];
  reason?: string;
}

const flatten = (root: SceneNodeMeta): SceneNodeMeta[] => {
  const out: SceneNodeMeta[] = [];
  const walk = (n: SceneNodeMeta) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
};

const at = (root: SceneNodeMeta, path: number[]): SceneNodeMeta | null => {
  let node: SceneNodeMeta | undefined = root;
  for (const i of path) {
    node = node?.children[i];
    if (!node) return null;
  }
  return node ?? null;
};

/**
 * Anything carrying walkable roots — a `SceneMeta` from the manifest, or the
 * `FileNodes` the outline's drill-in fetches for a file the manifest never
 * listed. Both resolve identically; the drill-in is not a special case.
 */
export interface RootsHolder {
  roots: Record<string, SceneNodeMeta>;
}

export function resolveAnchor(scene: RootsHolder, anchor: NodeAnchor): AnchorResolution {
  const root = scene.roots[anchor.component];
  if (!root) return { reason: `no JSX-returning function named ${anchor.component}` };

  const hit = at(root, anchor.path);
  if (hit && hit.tag === anchor.tag && hit.fp === anchor.fp) {
    return { node: hit, path: anchor.path, relocated: false };
  }

  const all = flatten(root);
  const uniq = (list: SceneNodeMeta[]) => (list.length === 1 ? list[0] : null);
  const found =
    (anchor.fpx ? uniq(all.filter((n) => n.fpx === anchor.fpx)) : null) ??
    uniq(all.filter((n) => n.fp === anchor.fp));
  if (found) return { node: found, path: found.path, relocated: true };

  const candidates = all.filter((n) => n.fp === anchor.fp).map((n) => n.path);
  return {
    candidates,
    reason:
      `node anchor no longer resolves (path ${anchor.path.join('.')}, <${anchor.tag}>, ` +
      `fp ${anchor.fp}; ${candidates.length} candidate${candidates.length === 1 ? '' : 's'})`,
  };
}

/**
 * The reverse direction: a CLICK in the frame → a BASELINE anchor.
 *
 * The DOM the designer clicked is the PATCHED tree (the frame is served with the
 * staged plan applied — the only way a `layout-insert` can preview at all), but
 * every intent is expressed in the baseline frame. So the stamped `path` is a
 * hint that is only reliable while nothing structural is staged, and `fp` is the
 * identity — which works because `fpOf` excludes className content and the child
 * tag sequence, so a node keeps its fingerprint across its own class edit and
 * across an insert into its parent.
 *
 * Three outcomes, and the third is not a failure:
 *
 *   - `anchor`      — resolved. Edit it.
 *   - `candidates`  — several baseline nodes share the fingerprint. REFUSE, and
 *                     let the human pick; guessing between two identical
 *                     `<span>·</span>` nodes would write to the wrong one
 *                     silently, which is the worst failure this tool has.
 *   - `created`     — no baseline node matches, so this node was produced by a
 *                     staged `layout-insert`. By the CP2 client invariant a node
 *                     created this session has no baseline anchor at all: it is
 *                     edited through the parent insert's `raw` payload, so the
 *                     caller must route there rather than stage a new intent.
 */
export interface StampResolution {
  anchor?: NodeAnchor;
  node?: SceneNodeMeta;
  created?: boolean;
  candidates?: number[][];
  reason?: string;
}

export function anchorFromStamp(
  holder: RootsHolder,
  file: string,
  stamp: { component: string; path: number[]; fp: string; tag: string },
): StampResolution {
  const root = holder.roots[stamp.component];
  if (!root) {
    return { reason: `no JSX-returning function named ${stamp.component} in ${file}` };
  }

  const anchor: NodeAnchor = {
    file,
    component: stamp.component,
    path: stamp.path,
    tag: stamp.tag,
    fp: stamp.fp,
  };

  // Reuse the one resolution routine rather than a second copy of the rules:
  // path (verified by tag + fp) → unique fp. `fpx` is deliberately absent — the
  // DOM stamp does not carry it, and the path hint plus fp is exactly the
  // information a click has.
  const r = resolveAnchor(holder, anchor);
  if (r.path && r.node) {
    return { anchor: { ...anchor, path: r.path, fpx: r.node.fpx }, node: r.node };
  }
  if (r.candidates && r.candidates.length > 1) {
    return { candidates: r.candidates, reason: r.reason };
  }
  return {
    created: true,
    reason:
      `<${stamp.tag}> has no counterpart on disk, so it was created by a staged ` +
      `insert. Edit it through that insert rather than as its own edit.`,
  };
}

/** One anchor that moved, or could not be found, after a metadata refresh. */
export interface AnchorRebase extends EditRef {
  /** The anchor field to rewrite (`anchor` for every layout op today). */
  field: 'anchor' | 'toParent';
  path?: number[];
  fpx?: string;
  /** Set when the anchor could not be resolved — the edit should go stale. */
  lost?: boolean;
  reason?: string;
  candidates?: number[][];
}

/**
 * Where an anchor's node tree comes from.
 *
 * NOT just `SceneMeta[]`, and the difference is the drill-in. An edit made after
 * opening `<DocumentList/>`'s definition is anchored in `document-list.tsx`,
 * while the scene it was made from is `documents/page.tsx` — so resolving it
 * against `scene.roots` looks up a root that lives in a different file, fails,
 * and reports the edit LOST. Every drill-in edit would go stale on the first
 * metadata refresh, which is every commit.
 *
 * Returning `null` means "I have no tree for this file", which is explicitly
 * NOT the same as "this anchor is gone" — see `planRebase`.
 */
export type RootsLookup = (anchor: NodeAnchor, sceneId: string) => RootsHolder | null;

/** Build a lookup from the manifest scenes plus whatever files are cached. */
export function rootsLookup(
  scenes: SceneMeta[],
  files: Record<string, RootsHolder | undefined> = {},
): RootsLookup {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const byFile = new Map(scenes.map((s) => [s.file, s as RootsHolder]));
  return (anchor, sceneId) => {
    // The anchor's own file wins: it is the file the edit will be written to.
    if (files[anchor.file]) return files[anchor.file]!;
    if (byFile.has(anchor.file)) return byFile.get(anchor.file)!;
    // Fall back to the scene only when it IS that file, never blindly — see the
    // `RootsLookup` note.
    const scene = byId.get(sceneId);
    return scene && scene.file === anchor.file ? scene : null;
  };
}

/**
 * Re-resolve every staged layout anchor against fresh metadata.
 *
 * Feed the result to `history.rebaseAnchors` (for the ones that moved) and to the
 * stale-marking path (for the ones that were lost). Rebasing must NOT flip
 * `dirty`, which is why `editStateKey` excludes `path`/`fpx`.
 *
 * UNKNOWN IS NOT LOST. When the lookup has no tree for an anchor's file the edit
 * is skipped entirely rather than marked stale. Marking it would be a guess
 * dressed as a verdict: the file is almost certainly fine and simply not cached,
 * and "this edit can no longer be applied" is a claim that costs the user their
 * work when it is wrong. A genuinely unresolvable anchor still fails at save
 * time, where the error comes from the server that actually tried it.
 */
export function planRebase(
  layoutEdits: Record<string, { anchor: NodeAnchor; toParent?: NodeAnchor; sceneId: string }>,
  rootsOf: RootsLookup,
): AnchorRebase[] {
  const out: AnchorRebase[] = [];

  for (const [key, edit] of Object.entries(layoutEdits)) {
    for (const field of ['anchor', 'toParent'] as const) {
      const anchor = edit[field];
      if (!anchor) continue;
      const holder = rootsOf(anchor, edit.sceneId);
      if (!holder) continue; // unknown ≠ lost
      const r = resolveAnchor(holder, anchor);
      if (!r.path) {
        out.push({ map: 'layoutEdits', key, field, lost: true, reason: r.reason, candidates: r.candidates });
        continue;
      }
      if (r.relocated || r.path.join('.') !== anchor.path.join('.') || r.node!.fpx !== anchor.fpx) {
        out.push({ map: 'layoutEdits', key, field, path: r.path, fpx: r.node!.fpx });
      }
    }
  }
  return out;
}
