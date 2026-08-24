/**
 * Types mirroring the output of `scripts/extract-design-metadata.mjs` (Phase 1).
 *
 * These describe the *shape* of `design-metadata.json`. The sandbox consumes
 * this AST-derived data — it never re-parses source in the browser. Keep in
 * sync with the extractor's emitted JSON.
 */

/**
 * A single color-utility usage: the Tailwind utility (`bg`, `text`, `ring`, …)
 * and the semantic role it targets (`primary`, `destructive`, …). The sandbox
 * maps `utility` to a human-readable property label.
 */
export interface ColorBinding {
  utility: string;
  role: string;
}

/**
 * A non-color scale-token usage: border-radius (`rounded-md`), spacing
 * (`px-4`, `gap-2`) or font-size (`text-sm`). `value` is the scale step.
 */
export interface ScaleBinding {
  category: 'radius' | 'spacing' | 'fontSize';
  utility: string;
  value: string;
  className: string;
}

/** Per-string-blob token + anti-pattern analysis. */
export interface Analysis {
  tokensUsed: string[];
  colorBindings: ColorBinding[];
  scaleBindings: ScaleBinding[];
  antiPatterns: {
    hardcodedPaletteColors: string[];
    hardcodedNamedColors: string[];
    hexLiterals: string[];
    rgbHslLiterals: string[];
    arbitraryPx: string[];
  };
}

/** A single CVA variant value: its raw class string plus its analysis. */
export interface CvaValue extends Analysis {
  classes: string;
}

/** A parsed `cva(...)` definition, broken down per variant value. */
export interface CvaMeta {
  name: string;
  base: CvaValue;
  /** axisName → valueName → analysis, e.g. `axes.variant.destructive`. */
  axes: Record<string, Record<string, CvaValue>>;
  /** axisName → default valueName. */
  defaults: Record<string, string>;
}

export interface PropMeta {
  name: string;
  type: string;
  optional: boolean;
  origin: string;
}

export interface ComponentMeta extends Analysis {
  name: string;
  kind: 'function' | 'forwardRef';
  /**
   * Reachable from outside the file.
   *
   * A component the file keeps to itself is still analysed — it has classes and a
   * place in the tree — but it cannot be imported, so the preview cannot mount it.
   * Optional because a manifest analysed before this existed reports nothing.
   */
  exported?: boolean;
  props: PropMeta[];
  propOrigins: string[];
  cva: CvaMeta | null;
}

export interface FileMeta {
  file: string;
  module: string;
  components: ComponentMeta[];
  orphanCva: string[];
  /**
   * The JSX node tree, present when the file was analysed for the outline as well as for
   * its variant tables. `analyzeFile` alone does not produce one — `analyzeNodes` does,
   * and `GET /metadata` merges both for every declared component, because a drill-in
   * target with no tree renders as a component with no nodes.
   */
  roots?: Record<string, SceneNodeMeta>;
  imports?: { module: string; named: string[]; default?: string }[];
  /** Names two JSX-returning functions both claim; unaddressable, so omitted from `roots`. */
  ambiguous?: string[];
}

// ---------------------------------------------------------------------------
// Scenes (Phase 3) — the JSX node tree of a whole route file.
// ---------------------------------------------------------------------------

/**
 * One JSX element in a scene's source AST.
 *
 * A node is NOT a DOM node: one source node renders to 0..N DOM nodes (zero
 * behind a falsy conditional, N inside a `.map()`). `repeated` is how the UI
 * knows to say "this edit applies to all 3 rows".
 */
export interface SceneNodeMeta {
  /** Child-index path from the walkable root. A HINT — `fp` is the identity. */
  path: number[];
  /** `div` | `Link` | `Card.Header`; `#returns` for the synthetic root. */
  tag: string;
  /** Attribute names present, sorted; `...` for a spread. */
  attrs: string[];
  /**
   * The editable class blob: `className`'s own literal, or the first string
   * argument of a recognised joiner call (`cn("p-2", x)` → `"p-2"`). Null when no
   * literal is attributable — including when there is no `className` at all.
   */
  className: string | null;
  /**
   * `className`'s expression as written, when the value is more than that
   * literal — `cn("p-2", x)`, `t("nav.home")`, `styles.row`. Null for a plain
   * literal and for no attribute.
   *
   * A SIBLING of `className`, never a replacement: the pair says how editable
   * the node's classes are, and the read-only case the UI must show is
   * `className === null && classNameExpr !== null` (an expression the injector
   * refuses to rewrite). `classNameExpr !== null` on its own only means an
   * expression exists. Verbatim source text, so it may contain newlines.
   */
  classNameExpr: string | null;
  /** Values of the identity-attribute allowlist that feeds `fp`. */
  identity: Record<string, string>;
  text: string | null;
  /** Stable identity: survives edits to other nodes, collides freely. */
  fp: string;
  /** Extended identity: + classes + child tags. The first relocation key. */
  fpx: string;
  analysis: Analysis;
  /**
   * `static`    — directly in the root's returned JSX; all ops allowed.
   * `iteration` — inside a `.map`/`.filter`/… callback; `layout-props` only.
   * `callback`  — inside another inline function; `layout-props` only.
   */
  scope: 'static' | 'iteration' | 'callback';
  /** Mirrored server-side as a hard guard in `resolveNode`, not a client hint. */
  structuralEditable: boolean;
  repeated: boolean;
  /** Intrinsic tags always receive a stamped `data-*`; components may not. */
  clickSelectable: boolean;
  children: SceneNodeMeta[];
}

export interface SceneMeta {
  id: string;
  kind: 'dom' | 'canvas';
  label: string;
  /** Repo-relative. */
  file: string;
  export: string;
  /** Which root the scene mounts — a key of `roots`. */
  component: string | null;
  route?: string;
  /** The react-router PATTERN to register, when it differs from the literal
   *  `route` above — see `vite.config.ts`'s `SceneConfig`. */
  routePattern?: string;
  /** `"app"` mounts the scene inside the real `app/Layout.tsx` shell. */
  shell?: 'app';
  mocks: string[];
  fixtures?: Record<string, string>;
  viewports?: string[];
  readOnly?: boolean;
  /**
   * Declared but not mountable yet — the frame's loader table excludes it.
   *
   * A real intent, not a mistake: the scene names a file the metadata sweep checks, and its
   * node tree is analysed, but something it needs at runtime (providers, a mocked store) is
   * not in place. The shell must show it as unavailable rather than omit it — omitting it
   * would make a declared scene look undeclared — and must not offer it as a selection.
   */
  deferred?: boolean;
  /**
   * One walkable root per JSX-returning function — the component PLUS local
   * helpers like `renderRow`. That is what makes `items.map(renderRow)` a
   * supported case: the helper's JSX is `static` in its own root, so structural
   * ops work there while an inline `.map(d => …)` body stays `iteration`.
   * `NodeAnchor.component` names which root a path walks.
   */
  roots: Record<string, SceneNodeMeta>;
  imports: { module: string; named: string[]; default?: string }[];
}

export interface DesignMetadata {
  generatedBy: string;
  tokenVocabulary: { semanticRoles: string[] };
  files: FileMeta[];
  scenes: SceneMeta[];
  /**
   * `file → mtimeMs at parse time`. Lets the client say "my anchors describe
   * revision R of this file" and notice when they no longer do.
   */
  revs?: Record<string, number>;
  summary: {
    componentCount: number;
    uniqueTokensUsed: string[];
    antiPatternTotals: Record<string, number>;
  };
}

/** Depth-first walk of a scene root, for outline rendering and anchor lookup. */
export function walkSceneNodes(
  root: SceneNodeMeta,
  visit: (node: SceneNodeMeta) => void,
): void {
  visit(root);
  for (const c of root.children) walkSceneNodes(c, visit);
}

/** The node at `path` within `root`, or null. */
export function sceneNodeAt(root: SceneNodeMeta, path: number[]): SceneNodeMeta | null {
  let node: SceneNodeMeta | undefined = root;
  for (const i of path) {
    node = node?.children[i];
    if (!node) return null;
  }
  return node ?? null;
}

/** All anti-pattern keys, flattened, for a value/component. */
export function antiPatternList(a: Analysis): string[] {
  const p = a.antiPatterns;
  return [
    ...p.hardcodedPaletteColors,
    ...p.hardcodedNamedColors,
    ...p.hexLiterals,
    ...p.rgbHslLiterals,
    ...p.arbitraryPx,
  ];
}
