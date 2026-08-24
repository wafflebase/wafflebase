/**
 * The bridge's wire vocabulary — what a browser may ask the dev server to do.
 *
 * Every field here arrives from a web page, so these types are a CLAIM and not a
 * guarantee: `resolveSafe` re-checks paths, `inject.mjs` re-checks class tokens,
 * and `resolveNode` re-checks anchors. The interfaces document the protocol; they
 * do not validate it.
 *
 * The token kinds are declared even though 8a implements none of them. The bridge
 * dispatches on `kind`, so leaving them out would mean a token intent falls
 * through to "unknown kind" — indistinguishable from a typo — instead of the
 * honest "no token adapter configured" that §3 promises for any project outside
 * the support matrix.
 */

/** Which side of the before/after comparison a frame renders. */
export type FrameSide = 'before' | 'after';

/** Where a JSX node lives: a path HINT verified by a fingerprint (the truth). */
export interface NodeAnchor {
  /** Root-relative. */
  file: string;
  component: string;
  path: number[];
  tag: string;
  fp: string;
  fpx?: string;
}

export type MutateKind =
  // layout — 8a
  | 'layout-props'
  | 'layout-insert'
  | 'layout-remove'
  // class rewriting inside a CVA value — 8a
  | 'class-rewrite'
  // tokens — declared here, implemented in 8b behind `TokenAdapter`
  | 'token-value'
  | 'token-add'
  | 'token-rebind'
  | 'palette-value'
  | 'member-add'
  | 'member-remove';

/** Token families, as wafflebase's own pipeline groups them. Used only by 8b. */
export type TokenFamily = 'semantic' | 'palette' | 'radius' | 'typo';

export interface MutateRequest {
  kind?: MutateKind;
  /** Root-relative path. */
  file?: string;
  /** Compute the edit and diff without writing — drives the review modal. */
  dryRun?: boolean;
  /**
   * Members of a group ALL apply or none do. Without it a `layout-move`
   * (remove + insert) whose insert failed to locate would delete a node and drop
   * it, and a promote-to-token batch whose class-rewrite failed would leave an
   * orphan token across three files.
   */
  groupId?: string;

  // --- layout-props / layout-remove ---
  anchor?: NodeAnchor;
  sets?: { name: string; value: string | null; valueKind?: 'string' | 'expression' }[];
  classOps?: {
    replacements?: { from: string; to: string }[];
    additions?: string[];
    removals?: string[];
  };
  text?: string | null;

  // --- layout-insert ---
  parent?: NodeAnchor;
  index?: number;
  raw?: string;
  /** Replay of a previously removed span: restores bytes, exempt from content validation. */
  verbatim?: boolean;
  /** Imports the snippet needs / the removal may free. Add-if-absent, drop-if-unused. */
  imports?: { module: string; named?: string[]; default?: string }[];

  // --- class-rewrite ---
  cvaName?: string;
  axis?: string;
  value?: string;
  replacements?: { from: string; to: string }[];
  additions?: string[];
  removals?: string[];

  // --- token kinds (8b) ---
  constName?: string;
  path?: string[];
  tokenValue?: string;
  valueKind?: 'literal' | 'expression';
  family?: TokenFamily;
  camelKey?: string;
  kebabKey?: string;
}

export interface MutateResult {
  ok: boolean;
  error?: string;
  notes?: string[];
  applied?: number;
  diff?: string;
  files?: string[];
  backup?: string | null;
  txnId?: number;
}

/** One file's pristine and written text, for the undo/redo spine. */
export interface FileCheckpoint {
  /** Root-relative. */
  path: string;
  before: string;
  after: string;
}

export interface Transaction {
  id: number;
  ts: number;
  labels: string[];
  files: FileCheckpoint[];
}

/** The layout kinds, which are the only ones that carry a `NodeAnchor`. */
export const LAYOUT_KINDS: ReadonlySet<string> = new Set([
  'layout-props',
  'layout-insert',
  'layout-remove',
]);

/**
 * The root-relative file a layout intent targets.
 *
 * Read off the ANCHOR, never off `intent.file`. A layout intent addresses a node,
 * and the node's file is a property of the anchor; `file` is the token kinds'
 * field. Reading `file` here would silently target nothing for every layout
 * intent, and `planFiles` would then report an empty set — so a frame would serve
 * unpatched source while claiming the plan was applied.
 */
export function layoutFileOf(intent: MutateRequest): string | null {
  if (!LAYOUT_KINDS.has(intent.kind ?? '')) return null;
  return (intent.anchor ?? intent.parent)?.file ?? null;
}

/**
 * The root-relative file a PATCHABLE intent targets, whatever kind it is.
 *
 * `planFiles` used to be `layoutFileOf` alone, and the consequence was that a class edit
 * never previewed AT ALL: the set came back empty for it, so `scene-patch` served the
 * component unpatched and `publishPlan` reloaded nothing. Rebinding a variant's
 * background staged an edit, incremented the Save badge, and changed nothing on screen —
 * which reads as the editor being broken rather than as one intent kind being missing
 * from one set.
 *
 * TOKEN KINDS STAY OUT, and that is not an oversight. A token value reaches the frame as
 * a CSS custom property over `wb:set-token-vars`, which needs no module patch and works
 * in a scene the token source never reaches. Patching their source files here would be a
 * second, redundant path to the same pixels.
 */
export function planFileOf(intent: MutateRequest): string | null {
  if (LAYOUT_KINDS.has(intent.kind ?? '')) return (intent.anchor ?? intent.parent)?.file ?? null;
  return intent.kind === 'class-rewrite' ? (intent.file ?? null) : null;
}

/** Every file a staged plan touches — the set a frame must serve patched. */
export const planFiles = (intents: MutateRequest[]): Set<string> =>
  new Set(intents.map(planFileOf).filter((f): f is string => !!f));
