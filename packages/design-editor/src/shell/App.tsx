/**
 * The three-pane editor shell.
 *
 * Scene list · live frame · outline + node detail, with a floating class editor over
 * the frame and one header that owns the whole session: dark, undo/redo, dirty count,
 * stale edits, the write log, and Save to Code.
 *
 * THREE THINGS DIFFER FROM THE PROTOTYPE'S `SandboxLayout`, and each is forced:
 *
 *  1. THE SCENE LIST COMES FROM `GET /metadata`, not from `virtual:wb-scenes`. The
 *     shell is prebuilt and cannot import a module the consumer's dev server
 *     generates — that asymmetry is the whole reason the frame is a separate entry.
 *     11a hardcoded a single scene id for exactly this reason; the manifest reaching
 *     the shell over HTTP is what replaces it.
 *
 *  2. THE DRILL-IN CACHE IS NOT A CACHE. `/metadata` already carries `roots` for
 *     every analysed file, so opening a component is a lookup in a payload we hold
 *     rather than a per-file request — which also deletes the prototype's most
 *     delicate refresh step (re-fetching each drilled-into file so its staged edits
 *     could still be rebased). One payload, one refresh, nothing to forget.
 *
 *  3. SAVE WRITES DIRECTLY. `ReviewApproveModal` is PR 12; until it lands, ⌘S sends
 *     the plan and reports what came back. The plan count and the write log are in
 *     the header, so what a save will do is visible before it happens — but the
 *     per-intent diff review is genuinely absent, and that is stated rather than
 *     implied by a disabled button.
 *
 * NOT PORTED, on purpose: the `components` mode (`ComponentList` + `PreviewPane`).
 * It edits one primitive's CVA values, which is a different addressing scheme and a
 * different preview mechanism from a scene's `NodeAnchor`, and it is in neither 11b's
 * file list nor 12's. Saying so here beats leaving a reader to wonder where the mode
 * toggle went.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  HardDriveDownload,
  Info,
  Moon,
  Palette,
  RotateCcw,
  ScrollText,
  Sun,
} from 'lucide-react';
import {
  camelToKebab,
  createBridgeClient,
  defaultVariantState,
  forcedStateClasses,
  mockPropsFor,
  noopPropsFor,
  STATES,
  type StateKey,
  layoutEditKey,
  type BridgeClient,
  saveDiff,
  type EditState,
  type HealthResult,
  type MetadataResult,
  type PendingLayoutEdit,
  type TokensResult,
  type TransactionSummary,
  tokenPreviewStyle,
  type VariantState,
} from '../client/index.ts';
import { anchorFromStamp, planRebase, rootsLookup, type RootsHolder } from '../client/anchors.ts';
import { useEditHistory } from '../client/history.ts';
import { cn } from './lib/cn.ts';
import { SceneHost } from './scenes/SceneHost.tsx';
import { SceneOutline, type OutlineFile } from './scenes/SceneOutline.tsx';
import { SceneNodeDetail, type SceneSelection } from './scenes/SceneNodeDetail.tsx';
import { FloatingClassEditor } from './scenes/FloatingClassEditor.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs.tsx';
import { ComponentList } from './panels/ComponentList.tsx';
import { PreviewDataPanel } from './panels/PreviewDataPanel.tsx';
import { ReviewApproveModal } from './panels/ReviewApproveModal.tsx';
import { TokenBindingPanel } from './panels/TokenBindingPanel.tsx';
import { TokenEditorPanel } from './panels/TokenEditorPanel.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx';
import { sceneNodeAt, type FileMeta, type SceneMeta } from '../types.ts';
import { stampId, type FrameRect, type StampRef } from '../scenes/frame-protocol.ts';
import { resolveImport } from '../scenes/import-paths.ts';
import { closeAllPopovers } from './ui/popover.tsx';
import type { IconSlot } from '../scenes/preview-icons.tsx';

const defaultBridge = createBridgeClient();

/**
 * The semantic role vocabulary — the adapter's own keys, not a compiled-in list.
 *
 * The prototype passed `mockMetadata.tokenVocabulary.semanticRoles`, a frozen snapshot of
 * wafflebase's roles. What a binding may point at is whatever the consumer's semantic family
 * actually declares, which `GET /tokens` reports per theme.
 */
const SEMANTIC_VOCABULARY = (tokens: TokensResult | null): string[] =>
  Object.keys(tokens?.bindings?.themed.light ?? {}).map(camelToKebab).sort();

/** A `FileMeta` as the outline's `RootsHolder`, or null when it has no tree. */
const toHolder = (f: FileMeta | null): RootsHolder | null => (f?.roots ? { roots: f.roots } : null);

/** View state worth surviving a reload, but NOT part of the undo history. */
const VIEW_KEY = 'design-editor:view:v1';
interface ViewState {
  dark: boolean;
  scene: string;
  mode: 'components' | 'scenes';
}
const readView = (): Partial<ViewState> => {
  try {
    return JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<ViewState>;
  } catch {
    return {};
  }
};

/**
 * A user-facing message. Replaces the prototype's `sandbox/toast` module, which is
 * not in 11b's file list — and a strip in the header suits this better anyway: a
 * write failure is something to read while looking at the plan that caused it, not
 * something to catch before it fades.
 */
interface Notice {
  id: number;
  kind: 'info' | 'error';
  title: string;
  detail?: string;
}

/**
 * The bridge is a PARAMETER so the layout can be driven without a dev server. The shell
 * entry passes nothing and gets the real client; a test passes a stub and can then
 * assert on what a save actually sent.
 */
/**
 * The node's baseline class list, or `null` when a class edit cannot attach at all.
 *
 * `className === null` is NOT by itself a reason to refuse. It collapses two shapes and
 * only one of them is unsupported:
 *
 *   - an expression with no literal to rewrite (`classNameExpr !== null`) — the injector
 *     will not touch it, so offering the control would promise a write that gets refused
 *   - NO `className` attribute at all — common for a thin `.map()` row wrapper. Starting
 *     from an empty list loses nothing; the injector creates the attribute on the first
 *     real edit.
 */
export function editableClasses(node: {
  className: string | null;
  classNameExpr: string | null;
}): string[] | null {
  if (node.className === null && node.classNameExpr !== null) return null;
  return node.className ? node.className.split(/\s+/).filter(Boolean) : [];
}

/** Baseline with the staged ops applied — what the panel shows and edits. */
export function effectiveClasses(
  baseClasses: string[],
  ops?: { additions?: string[]; removals?: string[] },
): string[] {
  if (!ops) return baseClasses;
  const removed = new Set(ops.removals ?? []);
  const out = baseClasses.filter((c) => !removed.has(c));
  for (const a of ops.additions ?? []) if (!out.includes(a)) out.push(a);
  return out;
}

/**
 * The staged edit for a class change, or `null` to drop it.
 *
 * `FloatingClassEditor` hands back the FULL desired class list, and the diff is taken
 * against the node's BASELINE classes — never against its current effective list. The
 * staged edit already carries any earlier diff, so re-deriving `additions`/`removals`
 * from the staged state would COMPOUND rather than replace it: adding `p-2` then `p-4`
 * would emit both as additions instead of one, and removing a class then restoring it
 * would leave it in both lists.
 *
 * Returning to the baseline drops the edit rather than leaving a no-op in the plan —
 * unless something else was staged on the same node, which must survive.
 */
export function nextLayoutEdit(
  existing: PendingLayoutEdit | undefined,
  seed: { anchor: PendingLayoutEdit['anchor']; scopeLabel: string; sceneId: string },
  baseClasses: string[],
  nextClasses: string[],
): PendingLayoutEdit | null {
  const additions = nextClasses.filter((c) => !baseClasses.includes(c));
  const removals = baseClasses.filter((c) => !nextClasses.includes(c));
  if (!additions.length && !removals.length && !existing?.sets && existing?.textFrom === undefined) {
    return null;
  }
  return {
    ...(existing ?? {
      key: layoutEditKey(seed.anchor, `props:${seed.anchor.fp}`),
      op: 'props' as const,
      sceneId: seed.sceneId,
      anchor: seed.anchor,
      label: 'class edit',
      scopeLabel: seed.scopeLabel,
    }),
    classOps: additions.length || removals.length ? { additions, removals } : undefined,
  };
}

export function App({ bridge = defaultBridge }: { bridge?: BridgeClient } = {}) {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [meta, setMeta] = useState<MetadataResult | null>(null);
  const [dark, setDark] = useState(() => readView().dark ?? false);
  const [sceneId, setSceneId] = useState(() => readView().scene ?? '');
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeId = useRef(0);
  const notify = useCallback((kind: Notice['kind'], title: string, detail?: string) => {
    const id = ++noticeId.current;
    setNotices((prev) => [...prev.slice(-2), { id, kind, title, detail }]);
  }, []);

  const [selection, setSelection] = useState<SceneSelection | null>(null);
  /** `undefined` = not measured yet for this selection; `null` = the frame has no
   *  visible box for it right now. */
  const [selectionRect, setSelectionRect] = useState<FrameRect | null | undefined>(undefined);
  /** Host-page pixel rect for the same selection — what `FloatingClassEditor` anchors
   *  to. A different question from `selectionRect`, which is frame-local and only ever
   *  asked about visibility. */
  const [selectionHostRect, setSelectionHostRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  /** Dismissed without deselecting — e.g. to see the frame underneath. */
  const [classEditorClosed, setClassEditorClosed] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /*
   * Deliberately NOT persisted in `readView()`, unlike `dark` and `scene`. Those two are
   * "where you are" and should survive a reload; this is "what am I inspecting right now".
   * Restoring it would reopen the editor on empty lists with no memory of having asked for
   * them, which reads as fixtures that broke overnight.
   */
  const [mockDataEmpty, setMockDataEmpty] = useState(false);
  /*
   * Which SUBJECT the panes are addressing — the recipe's two modes (§ "There are two
   * MODES"). They differ in addressing (a CVA value vs a `NodeAnchor`) and in what the
   * right pane can usefully say, which is why they are modes and not two lists in one
   * tree: `TokenBindingPanel` takes a component, so while a whole route is under edit it
   * would be describing a Button nobody is looking at.
   *
   * Persisted, unlike `mockDataEmpty` and like `dark`/`scene`: it is "where you are".
   */
  const [mode, setMode] = useState<'components' | 'scenes'>(
    () => readView().mode ?? 'scenes',
  );
  const [selectable, setSelectable] = useState<Set<string>>(new Set());
  const [drillTrail, setDrillTrail] = useState<string[]>([]);
  /** The staged edits a refresh says can no longer be applied, `map|key` → why. */
  const [staleKeys, setStaleKeys] = useState<Record<string, string>>({});
  const [writeLog, setWriteLog] = useState<TransactionSummary[]>([]);
  const [writeDepth, setWriteDepth] = useState(0);
  const [reapplyDepth, setReapplyDepth] = useState(0);
  const [busy, setBusy] = useState(false);
  /** `GET /tokens` — the adapter's report. Re-read after every write, like metadata. */
  const [tokens, setTokens] = useState<TokensResult | null>(null);
  /**
   * Which component the binding panel edits. A NAME, not the object: `allComponents` is
   * replaced wholesale by every metadata refresh, and holding the object would pin a stale
   * copy whose CVA no longer matches the file.
   */
  const [componentName, setComponentName] = useState<string | null>(null);
  const [variantState, setVariantState] = useState<VariantState>({});
  /**
   * Which interaction state the component preview is forced into.
   *
   * `null` is the resting component. A state renders it with that state's classes
   * applied unconditionally — `forcedStateClasses` strips the `hover:` modifier so the
   * rule applies without a pointer, which is the only way to LOOK at a hover style.
   * The bindings panel already lists every state's rows; this is the other half, which
   * is seeing what those rows describe.
   */
  const [forcedState, setForcedState] = useState<StateKey | null>(null);
  /** Preview-only children for the component pane. Never written to source. */
  /** Widths of the two side panes, in px. The centre is whatever is left. */
  const [paneWidth, setPaneWidth] = useState({ left: 220, right: 340 });

  const [previewLabel, setPreviewLabel] = useState('');
  /**
   * The stand-in glyph the preview renders inside the component, and where.
   *
   * View state, not an edit: it changes what the pane SHOWS, never the source. Kept
   * beside `previewLabel` because both answer the same question — what the component's
   * children are — and the panel presents them as one control.
   */
  const [iconSlot, setIconSlot] = useState<IconSlot>('none');
  const [icon, setIcon] = useState('plus');
  /**
   * Stand-in values for the selected component's required props, as edited.
   *
   * Seeded from the declared types and then owned by the user — `null` means "not yet
   * touched for this component", which is how the seed knows to run again after a
   * selection change without discarding an edit mid-session.
   */
  const [mockProps, setMockProps] = useState<Record<string, unknown> | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const onHistoryReset = useCallback(
    () => notify('info', 'Dev server restarted', 'The persisted edit history was cleared.'),
    [notify],
  );
  const history = useEditHistory(health?.ok ? (health.session ?? null) : null, onHistoryReset);
  const { layoutEdits } = history.state;

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify({ dark, scene: sceneId, mode } satisfies ViewState));
    } catch {
      /* a disabled store just means the view does not survive a reload */
    }
  }, [dark, sceneId, mode]);

  // ---------------------------------------------------------------------------
  // Metadata. Re-read after every write, because it is derived from source: a
  // `layout-insert` renumbers every following sibling, so a client holding a
  // pre-write tree resolves the next click onto the wrong node.
  // ---------------------------------------------------------------------------
  /**
   * `layoutEdits` read through a ref on purpose. Making it a dependency of the
   * refresh would rebuild the callback on every keystroke and re-fire every effect
   * that depends on it; the refresh's trigger is a write or an external change,
   * never an edit.
   */
  const rebaseInputs = useRef({ layoutEdits, rebase: history.rebaseAnchors });
  rebaseInputs.current = { layoutEdits, rebase: history.rebaseAnchors };

  const refreshMetadata = useCallback(async () => {
    const d = await bridge.metadata();
    setMeta(d);
    // A write renumbers siblings, so a tree fetched before it is stale in exactly the
    // way `/metadata`'s own never-cache rule describes.
    setAnalysed({});
    if (!d.ok || !d.metadata) return;
    const scenes = d.metadata.scenes ?? [];
    const holders: Record<string, RootsHolder> = {};
    for (const f of d.metadata.files ?? []) if (f.roots) holders[f.file] = { roots: f.roots };

    const { layoutEdits: staged, rebase } = rebaseInputs.current;
    if (!Object.keys(staged).length) return;
    const moves = planRebase(staged, rootsLookup(scenes, holders));
    // Rebasing must NOT flip `dirty`; `editStateKey` excludes `path`/`fpx` so a
    // coordinate correction is invisible to the editor. `rebaseAnchors` takes the
    // whole list and skips the lost ones itself.
    rebase(moves);
    const lost = moves.filter((m) => m.lost);
    // Quiet: the `{N} stale` pill is the surface for this, and the refresh fires on
    // every write — a notice per write would be noise.
    if (lost.length) {
      setStaleKeys((prev) => {
        const next = { ...prev };
        for (const m of lost) next[`${m.map}|${m.key}`] = m.reason ?? 'no matching code found';
        return next;
      });
    }
  }, [bridge]);

  const refreshTokens = useCallback(async () => {
    setTokens(await bridge.tokens());
  }, [bridge]);

  const refreshWriteLog = useCallback(async () => {
    const h = await bridge.transactions();
    if (!h.ok) return;
    // The arrays ARE the depths; there is no separate count to trust or disagree with.
    setWriteDepth(h.undo?.length ?? 0);
    setReapplyDepth(h.redo?.length ?? 0);
    setWriteLog(h.undo ?? []);
  }, [bridge]);

  /**
   * The initial load, as ONE awaited sequence guarded by a generation.
   *
   * The guard is hardening rather than a fix: `main.tsx` renders `<App />` with no `bridge`
   * prop, so it is the module-level default and never changes, and the shell deliberately
   * runs without `StrictMode` — so there is no second mount to race against today. What
   * makes it worth the four lines is that this effect now names `bridge` in its
   * dependencies: the day a caller passes a different one, a slow answer from the old
   * bridge would otherwise land on the new session's state.
   *
   * `await`, not `.then`, per the repo's convention. Two things this deliberately does NOT
   * do. There is no try/catch: `BridgeClient`'s first documented rule is that nothing throws
   * — every method resolves to `{ ok: false, error }` precisely so a caller does not need one
   * — so it would add a branch no failure can reach. And the guard covers `setHealth` only:
   * the three `refresh*` callbacks set their own state internally, and guarding those would
   * mean threading a generation through each. Worth doing if a caller ever does swap the
   * bridge; not worth it for a race nothing can currently start.
   */
  useEffect(() => {
    let live = true;
    void (async () => {
      // CONCURRENT, as before. Awaiting them in sequence would turn one round trip into
      // four and slow the first paint for a guard that has nothing to catch yet.
      const [h] = await Promise.all([
        bridge.health(),
        refreshMetadata(),
        refreshTokens(),
        refreshWriteLog(),
      ]);
      if (live) setHealth(h);
    })();
    return () => {
      live = false;
    };
  }, [bridge, refreshMetadata, refreshTokens, refreshWriteLog]);

  /*
   * MEMOISED, and the reason is narrower than it looks. `meta?.metadata?.scenes ?? []`
   * returns the SAME array off `meta` once the manifest has loaded — measured, not assumed —
   * so the identity churn this looks like does not happen in the state that matters. What
   * does allocate is the `?? []` before `meta` arrives, and `exhaustive-deps` cannot tell the
   * two apart, so it flags five hooks downstream. Wrapping costs nothing, holds in both
   * states, and stops the question being re-litigated from the shape of the expression.
   */
  const scenes: SceneMeta[] = useMemo(() => meta?.metadata?.scenes ?? [], [meta]);
  /**
   * Files analysed ON DEMAND, keyed by root-relative path.
   *
   * `/metadata` returns exactly what the manifest declared. A drill-in can name a file
   * the manifest never listed — that is the point of it — so its tree arrives here and
   * overlays the declared set. Cleared when metadata is re-read, because a write can
   * renumber nodes and a tree fetched before it is stale in exactly the way the
   * `/metadata` comment describes.
   */
  const [analysed, setAnalysed] = useState<Record<string, FileMeta>>({});
  const files: FileMeta[] = useMemo(() => {
    const declared = meta?.metadata?.files ?? [];
    const names = new Set(declared.map((f) => f.file));
    return [...declared, ...Object.values(analysed).filter((f) => !names.has(f.file))];
  }, [meta, analysed]);
  /**
   * The manifest decides the default, and it has to be re-decided when the manifest
   * arrives: the persisted id may name a scene this project no longer has, and the
   * first render has no manifest at all.
   */
  const mountable = useMemo(() => scenes.filter((s) => !s.deferred), [scenes]);
  /**
   * ONE derivation, gated ONCE. These were computed inline at two call sites with
   * different guards — the vocabulary behind `families?.length`, `existingRoles` behind
   * nothing — while `SEMANTIC_VOCABULARY` reads `bindings.themed.light`, a different field.
   * An adapter with bindings but no families therefore produced an empty `allRoles` beside
   * a full `existingRoles`, which suppressed `promoteTarget` for roles the picker could not
   * offer either: no way forward, and no reason shown.
   */
  const vocabulary = useMemo(() => (tokens ? SEMANTIC_VOCABULARY(tokens) : []), [tokens]);
  const existingRoles = useMemo(() => new Set(vocabulary), [vocabulary]);
  useEffect(() => {
    if (!scenes.length) return;
    // MOUNTABLE only. A deferred scene has no loader, so defaulting to one opens a frame
    // whose single possible outcome is `no scene "<id>" in the scene manifest`.
    setSceneId((cur) => (mountable.some((s) => s.id === cur) ? cur : (mountable[0]?.id ?? '')));
  }, [scenes, mountable]);
  const activeScene = scenes.find((s) => s.id === sceneId);

  /**
   * Every analysed component, flattened out of `metadata.files`.
   *
   * The prototype seeded this from a 908-line build-time snapshot and replaced it from the
   * endpoint; there is no snapshot to seed from any more, so an empty list before the first
   * response is simply "not loaded yet" rather than "this project has no components".
   */
  /**
   * The component CATALOGUE — the project's declared components, not everything the
   * outline has happened to open.
   *
   * Read off `meta` rather than the merged `files`, which also carries whatever
   * drilling in analysed on demand. Through that list the catalogue grew every time
   * someone drilled, filling `components` mode with primitives nobody chose to list and
   * mostly reporting "no CVA variants" — the panel that mode exists to drive has
   * nothing to say about a component without them.
   *
   * So the two sets are deliberately different: `files` is "what has a tree", and this
   * is "what the project offers as a component".
   */
  const allComponents = useMemo(
    () =>
      (meta?.metadata?.files ?? [])
        /*
         * THE MODULE TRAVELS WITH THE COMPONENT.
         *
         * `ComponentMeta` does not carry its file — the file owns the components — and
         * the catalogue flattened that away, so the pane could only ever be one long
         * alphabetical column. At 8 declared files that was fine; at 25 it is 123
         * entries, most of them parts of one composite (`dropdown-menu` alone has 15),
         * and the shape of the list stopped telling you anything. Keeping `module` here
         * is what lets the list group by it — and it retires the lookup `componentFile`
         * used to do by searching every file for a matching name.
         */
        .flatMap((f) =>
          (f.components ?? []).map((c) => ({ ...c, module: f.module, file: f.file })),
        )
        /*
         * EXPORTED ONLY. The catalogue's entries are things you can select and preview,
         * and the preview imports by name — a file-local component answered
         * `exports no \`SortableHeader\`` the moment it was clicked. `document-list.tsx`
         * alone contributed four of them.
         *
         * `!== false` rather than `=== true`: metadata analysed before the extractor
         * reported this carries no flag, and hiding everything would be worse than
         * showing a component that might not open.
         */
        .filter((c) => c.exported !== false),
    [meta],
  );
  /*
   * The default selection prefers a component with a VARIANT TABLE.
   *
   * `allComponents[0]` is manifest order, which is now alphabetical over 25 files — so
   * the editor opened on `Avatar` and the Bindings tab greeted every new session with
   * "has no CVA variants". The first component that has one is what this mode is for.
   */
  const component =
    allComponents.find((c) => c.name === componentName) ??
    allComponents.find((c) => !!c.cva) ??
    allComponents[0];
  /** Which file the selected component came from — carried on the entry since 12d. */
  const componentFile = component?.file ?? null;

  /**
   * The selected component's PARTS — the other exports of its module.
   *
   * Same rule the catalogue folds by: the shortest export whose name prefixes every
   * other one in the module is the root, and the rest are its anatomy. Computed here
   * because the Layout tab is where they belong — see the tab body. Empty for anything
   * that is not a composite root.
   */
  /**
   * The composite root the selected component is a PART of, or null when it is not one.
   *
   * Clicking a part's chip swaps the preview to that part — and a part has no parts of
   * its own, so the chips vanished with it and there was no way back. This is the way
   * back, and it is the same relationship read from the other end.
   */
  const componentRoot = useMemo(() => {
    if (!component) return null;
    const siblings = allComponents.filter((c) => c.module === component.module);
    if (siblings.length < 2) return null;
    const shortest = siblings.reduce((a, b) => (b.name.length < a.name.length ? b : a));
    if (shortest.name === component.name) return null;
    return siblings.every((c) => c.name.startsWith(shortest.name)) ? shortest : null;
  }, [allComponents, component]);

  const componentParts = useMemo(() => {
    if (!component) return [];
    const siblings = allComponents.filter((c) => c.module === component.module);
    if (siblings.length < 2) return [];
    const shortest = siblings.reduce((a, b) => (b.name.length < a.name.length ? b : a));
    if (shortest.name !== component.name) return [];
    return siblings.every((c) => c.name.startsWith(shortest.name))
      ? siblings.filter((c) => c !== shortest)
      : [];
  }, [allComponents, component]);

  /*
   * CHANGING THE SUBJECT SHUTS EVERY FLOATING EDITOR.
   *
   * Two of them, and they get stuck for different reasons.
   *
   * A POPOVER (a token picker, a variant combobox) closes on an outside pointerdown and
   * on Escape, and nothing was telling it the subject had changed — so an open menu went
   * on offering roles for a component that had left the screen.
   *
   * `FloatingClassEditor` is the one you actually see, and it is not a popover at all: a
   * `fixed` panel rendered whenever `selection` is set. The frame is recreated on every
   * switch and the new one reports no selection, but the OLD selection stayed in this
   * state — so the panel hung over the new subject, editing a node from the previous
   * one. Clearing the selection is what closes it, and it has to be cleared anyway:
   * every anchor in it belongs to a frame that no longer exists.
   */
  useEffect(() => {
    closeAllPopovers();
    setSelection(null);
    setSelectionRect(undefined);
    setSelectionHostRect(null);
    setClassEditorClosed(false);
  }, [mode, component?.name, sceneId]);
  /*
   * A PERSISTED MODE THE PROJECT CANNOT OFFER. Same shape as the scene id that vanishes
   * above: the view survives a reload, the project it describes may not. Restored as-is,
   * the editor opens on `components` with its own switch disabled, showing `Bindings`
   * with nothing to bind.
   *
   * Runs after metadata, because before it arrives `allComponents` is legitimately empty
   * and switching then would override a mode the project does support.
   */
  useEffect(() => {
    if (meta && allComponents.length === 0) setMode('scenes');
  }, [meta, allComponents.length]);
  /** Re-seed the variant axes when the selection changes; edits are keyed per component. */
  const selectComponent = (name: string) => {
    const next = allComponents.find((c) => c.name === name);
    if (!next) return;
    setComponentName(name);
    setVariantState(defaultVariantState(next));
  };

  /*
   * SEED THE AXES FOR WHATEVER IS SELECTED, not only for a component someone clicked.
   *
   * `component` falls back to the first in the catalogue, so on load there is a
   * selection with no variant state behind it — the badges showed nothing chosen while
   * the panel and the preview both spoke about the defaults. Three views of one thing
   * disagreeing is worse than any of them being wrong.
   */
  useEffect(() => {
    // Re-seeded per component, beside the variant axes and for the same reason: the
    // previous component's values describe a different set of props.
    setMockProps(component ? mockPropsFor(component.props ?? []) : null);
  }, [component]);

  useEffect(() => {
    if (component) setVariantState(defaultVariantState(component));
    // The state belongs to the component you were looking at. Carrying `hover` into the
    // next one shows it forced into a state nobody chose, and the toolbar agrees with
    // the previous component rather than this one.
    setForcedState(null);
    // The trail belongs to the component you were in. Keeping it leaves the outline
    // showing a file the new component never composes.
    setDrillTrail([]);
  }, [component]);

  /*
   * A NEW SCENE STARTS AT ITS OWN FILE.
   *
   * `drillTrail` survived a scene change, so switching from Login — drilled into
   * `login-form.tsx` — to Documents left the outline showing the login form beside the
   * documents page. The breadcrumb said one thing, the frame another, and the file the
   * detail panel anchored to belonged to neither.
   */
  useEffect(() => {
    setDrillTrail([]);
  }, [sceneId]);

  /** Root-relative file → its own node tree, for every file the analyser read. */
  const holderOf = useCallback(
    (file: string): RootsHolder | null => {
      if (activeScene && file === activeScene.file) return { roots: activeScene.roots };
      const f = files.find((x) => x.file === file);
      return f?.roots ? { roots: f.roots } : null;
    },
    [activeScene, files],
  );

  /** `[0]` is always the scene's own file; drilling in pushes, a breadcrumb click pops. */
  const trail: OutlineFile[] = useMemo(() => {
    /*
     * IN COMPONENTS MODE THE TRAIL IS THE COMPONENT'S OWN FILE.
     *
     * A scene's trail starts at its route and grows as you drill. A component has no
     * route — the subject IS the file — so the outline roots there and drilling still
     * works from it, which is how you reach a primitive the component composes.
     */
    if (mode === 'components') {
      const h = componentFile ? holderOf(componentFile) : null;
      /*
       * THE SELECTED COMPONENT'S ROOT — PLUS ITS PARTS, when it has any.
       *
       * A file holds several components, and passing all of its roots listed every one:
       * 150 rows for `document-list.tsx`, describing five components nobody selected.
       * So the outline shows the subject's tree.
       *
       * For a COMPOSITE the subject's own tree is one element — `Card` returns a `div`
       * and its header, body and footer are sibling exports — so the parts belong in it
       * too. They are what `Card` is made of, and a tree of it that stops at the `div`
       * is a tree of nothing. The chips above jump to a part's own preview; these rows
       * select a node INSIDE one, which is what restyles it.
       */
      const wanted = component ? [component.name, ...componentParts.map((c) => c.name)] : [];
      const own =
        h && wanted.some((n) => h.roots[n])
          ? Object.fromEntries(wanted.filter((n) => h.roots[n]).map((n) => [n, h.roots[n]]))
          : (h?.roots ?? {});
      const out: OutlineFile[] = h && componentFile ? [{ file: componentFile, roots: own }] : [];
      for (const f of drillTrail) {
        const d = holderOf(f);
        if (d) out.push({ file: f, roots: d.roots });
      }
      return out;
    }
    const out: OutlineFile[] = [];
    if (activeScene) out.push({ file: activeScene.file, roots: activeScene.roots });
    for (const f of drillTrail) {
      const h = holderOf(f);
      if (h) out.push({ file: f, roots: h.roots });
    }
    return out;
  }, [mode, componentFile, component, componentParts, activeScene, drillTrail, holderOf]);

  /**
   * tag → the file that tag's component lives in, through the scene's own import list
   * and the consumer's own aliases. A project whose alias is `~` or `#app` resolves
   * here exactly as `@` does; a tag with no matching import is not drillable.
   */
  const fileOfTag = useCallback(
    (tag: string): string | null => {
      /*
       * RESOLVED AGAINST THE FILE ON SCREEN, not always the scene's.
       *
       * This read `activeScene.imports` unconditionally. In components mode there is no
       * scene relationship at all — the outline is showing `document-list.tsx`, and its
       * `Table`, `TableRow`, `DropdownMenuItem` were looked up in the LOGIN page's import
       * list, found nothing, and offered no drill-in. Drilling out of a component was
       * simply unreachable.
       *
       * The current file is the last entry of the trail: the scene, or whatever has been
       * drilled into since, or the component's own file.
       */
      const here = trail[trail.length - 1]?.file ?? activeScene?.file;
      if (!here) return null;
      const imports =
        here === activeScene?.file
          ? activeScene.imports
          : files.find((f) => f.file === here)?.imports;
      const imported = imports?.find((i) => i.default === tag || i.named?.includes(tag));
      if (!imported) return null;
      /*
       * RESOLUTION IS THE GATE, not prior analysis.
       *
       * This used to also require `files.some(f => f.file === resolved)`, so a drill-in
       * was offered only for the handful of paths `scenes.config.json` listed under
       * `components` — seven of them. Every other component resolved perfectly and was
       * refused anyway, which is why drilling into `LoginForm` did nothing.
       *
       * The old reason was that an unanalysed file shows an empty tree, reading as a
       * component with no nodes. `onDrillIn` analyses at the moment of the drill, so
       * that state no longer exists: a tree comes back, or a reason does.
       *
       * A tag with no matching import is still not drillable, and `resolveImport`
       * returns null for a bare specifier with no alias — so `Link` from
       * `react-router-dom` stays closed without a special case.
       */
      return resolveImport(here, imported.module, health?.aliases ?? []);
    },
    [activeScene, trail, files, health],
  );

  /**
   * Open a file the outline resolved, analysing it first if nobody has.
   *
   * The trail can only show a file `holderOf` can find a tree for, so the fetch has to
   * land BEFORE the push — pushing first would show a breadcrumb over an empty outline
   * for as long as the round trip takes, which is the exact appearance the old
   * declared-files gate existed to avoid.
   */
  /**
   * The file's tree, analysing it if nobody has — the shared step behind both ways in.
   *
   * Returns the meta rather than relying on the state it also writes: `setAnalysed` is
   * asynchronous, so a caller that needs the tree in the same turn (a frame click, which
   * must resolve an anchor immediately) cannot read it back out of `files` yet.
   */
  const ensureAnalysed = useCallback(
    async (file: string): Promise<FileMeta | null> => {
      const already = files.find((f) => f.file === file);
      if (already) return already;
      const r = await bridge.analyse(file).catch(() => null);
      if (!r?.ok || !r.file) {
        // Named, not silent. "does not parse" and "no such file" send you to different
        // places, and a drill-in that quietly does nothing reads as a broken outline.
        notify('error', 'Could not open that component', r?.error ?? `${file} could not be analysed.`);
        return null;
      }
      const meta = r.file as FileMeta;
      setAnalysed((prev) => ({ ...prev, [file]: meta }));
      return meta;
    },
    [bridge, files, notify],
  );

  const drillInto = useCallback(
    async (file: string) => {
      if (await ensureAnalysed(file)) syncTrailToRef.current(file);
    },
    [ensureAnalysed],
  );

  /** Show a drilled-into file, and keep the outline pointing at wherever a click landed. */
  const syncTrailTo = useCallback(
    (file: string) => {
      if (activeScene && file === activeScene.file) {
        setDrillTrail([]);
        return;
      }
      setDrillTrail((prev) => (prev[prev.length - 1] === file ? prev : [...prev, file]));
    },
    [activeScene],
  );
  /*
   * `drillInto` is declared above `syncTrailTo` because the outline reads it first, and
   * a ref is what lets it call forward without either becoming a dependency of the
   * other — a direct reference would be a use-before-declaration, and reordering them
   * would put the fetch below the thing that consumes it.
   */
  const syncTrailToRef = useRef(syncTrailTo);
  syncTrailToRef.current = syncTrailTo;

  // A stale rect from the PREVIOUS selection must not briefly read as this one's
  // visibility while the new measure round trip is in flight. A freshly picked node
  // also reopens the floating editor, even if it was dismissed for the last one.
  useEffect(() => {
    setSelectionRect(undefined);
    setClassEditorClosed(false);
  }, [selection?.stamp.id]);

  /**
   * A click in the frame → a BASELINE anchor.
   *
   * The DOM is the PATCHED tree — the only way a staged insert previews at all — and
   * every intent is expressed against the baseline, so the stamped path is a hint and
   * `fp` is the identity. `anchorFromStamp` applies the same unique-match rules the
   * server does and refuses on ambiguity.
   */
  const resolveStamp = useCallback(
    async (stamp: StampRef) => {
      /*
       * A CLICK IN THE FRAME GOES STRAIGHT IN.
       *
       * A click lands wherever the app painted — the shell's sidebar and header render
       * into the same frame as the scene, and so does every component the scene
       * composes. This used to refuse anything the manifest had not declared and told
       * the reader to go declare it, which is advice that stopped being true when
       * `/analyse` landed: the file can simply be read now.
       */
      const holder = holderOf(stamp.file) ?? toHolder(await ensureAnalysed(stamp.file));
      if (!holder) {
        // `ensureAnalysed` has already said why. This is the anchor's half of it.
        setSelection({ stamp, reason: `${stamp.file} could not be analysed, so this click has no source anchor.` });
        return;
      }
      // Drill the OUTLINE to match wherever the click resolved, so the tree beside the
      // frame is describing the same file as the detail panel.
      syncTrailTo(stamp.file);
      const res = anchorFromStamp(holder, stamp.file, {
        component: stamp.component,
        path: stamp.path,
        fp: stamp.fp,
        tag: stamp.tag,
      });
      setSelection({ stamp, ...res });
    },
    [holderOf, ensureAnalysed, syncTrailTo],
  );

  /**
   * A row in the outline → the same selection state a click produces.
   *
   * The stamp is SYNTHESISED, and every field comes from the tree the outline is
   * built from rather than from a previous selection — `fp` and `tag` are read at
   * `path`, and `instances` is 0 or 1 because the outline knows only whether a node
   * reached the DOM, never how many times. `0` therefore means "not painted", which
   * the detail panel reports rather than hides: a node behind a falsy conditional is
   * exactly what the outline exists for.
   */
  const selectFromOutline = useCallback(
    (id: string | null) => {
      if (!id) {
        setSelection(null);
        return;
      }
      const holder = trail.find((t) => id.startsWith(`${t.file}#`));
      if (!holder) return;
      const rest = id.slice(holder.file.length + 1);
      const colon = rest.lastIndexOf(':');
      if (colon <= 0) return;
      const component = rest.slice(0, colon);
      const tail = rest.slice(colon + 1);
      const path = tail === '' ? [] : tail.split('.').map(Number);
      const root = holder.roots[component];
      if (!root) return;
      const node = sceneNodeAt(root, path);
      if (!node) return;
      setSelection({
        stamp: {
          id,
          component,
          path,
          fp: node.fp,
          tag: node.tag,
          file: holder.file,
          instances: selectable.has(id) ? 1 : 0,
        },
        anchor: {
          file: holder.file,
          component,
          path,
          tag: node.tag,
          fp: node.fp,
          fpx: node.fpx,
        },
        node,
      });
    },
    [trail, selectable],
  );

  // ---------------------------------------------------------------------------
  // Staging.
  // ---------------------------------------------------------------------------
  /**
   * Stage into any one of `EditState`'s maps, as one history step.
   *
   * `coalesce` collapses a run of changes to the same control — a colour input's keystrokes
   * — into a single undo entry. Every panel's `onX` handler is one call to this, which is
   * what keeps undo/redo tracking EDITS rather than saves.
   */
  const setIn = <K extends keyof EditState>(
    map: K,
    key: string,
    value: EditState[K][string] | null,
    coalesce?: string,
  ) =>
    history.update((prev) => {
      const next = { ...prev[map] } as EditState[K];
      if (value === null) delete next[key];
      else next[key] = value as EditState[K][string];
      return { ...prev, [map]: next } satisfies EditState;
    }, coalesce);

  const setLayoutEdit = (key: string, value: PendingLayoutEdit | null) =>
    history.update((prev) => {
      const next = { ...prev.layoutEdits };
      if (value === null) delete next[key];
      else next[key] = value;
      return { ...prev, layoutEdits: next } satisfies EditState;
    }, `layout|${key}`);

  const onLayoutClassEdit = (
    anchor: PendingLayoutEdit['anchor'],
    scopeLabel: string,
    baseClasses: string[],
    nextClasses: string[],
  ) => {
    const key = layoutEditKey(anchor, `props:${anchor.fp}`);
    const existing = layoutEdits[key];
    const next = nextLayoutEdit(existing, { anchor, scopeLabel, sceneId }, baseClasses, nextClasses);
    setLayoutEdit(key, next);
  };

  /**
   * The floating editor's inputs: the BASELINE class list (what is on disk, per the
   * resolved node) and the EFFECTIVE list (baseline with any staged ops applied), which
   * is what the panel shows and edits. `null` when there is nothing a class edit could
   * attach to — matching `SceneNodeDetail`'s read-only-until-resolved rule.
   */
  const classEditTarget = useMemo(() => {
    if (!selection?.anchor || !selection.node) return null;
    const { node, anchor } = selection;
    const baseClasses = editableClasses(node);
    if (!baseClasses) return null;
    const staged = layoutEdits[layoutEditKey(anchor, `props:${anchor.fp}`)];
    return { anchor, baseClasses, effective: effectiveClasses(baseClasses, staged?.classOps) };
  }, [selection, layoutEdits]);

  // ---------------------------------------------------------------------------
  // Writing.
  // ---------------------------------------------------------------------------
  const plan = useMemo(() => saveDiff(history.baseline, history.state), [history.baseline, history.state]);

  /**
   * The staged token values, as CSS custom properties.
   *
   * Computed once and used TWICE: the binding panel paints its swatches with them, and
   * the frame is sent them over `wb:set-token-vars`. Only the first half was wired —
   * `SceneHost` has taken a `tokenVars` prop since the frame protocol landed and `App`
   * never passed one, so editing a token repainted the swatch beside the control and
   * left the actual page alone. Same shape of gap as the mock/empty toggle: an optional
   * prop nobody supplied, so nothing failed to compile and no test noticed.
   */
  const tokenVars = useMemo(
    () =>
      tokenPreviewStyle({
        theme: dark ? 'dark' : 'light',
        literalEdits: Object.values(history.state.tokenEdits),
        rebinds: Object.values(history.state.rebinds),
        paletteEdits: Object.values(history.state.paletteEdits),
        bindings: tokens?.bindings?.themed[dark ? 'dark' : 'light'],
      }) as Record<string, string>,
    [dark, history.state.tokenEdits, history.state.rebinds, history.state.paletteEdits, tokens],
  );

  /**
   * What a SWATCH paints with: the project's resolved token values, plus staged edits.
   *
   * Distinct from `tokenVars`, and the split matters. The frame gets staged values ONLY
   * — it already has the real stylesheet, and pinning the base values into it would
   * freeze whatever `tokens.css` said at load and defeat its own HMR. The shell has no
   * such stylesheet, so a swatch reading `var(--primary)` resolved to nothing and every
   * colour chip rendered empty.
   *
   * COLOURS ONLY. The same map carries `--font-sans`, `--radius` and friends, and
   * applying those to a shell element would restyle the editor with the project's
   * typography — which is the scene's job, not the chrome's.
   */
  const swatchVars = useMemo(() => {
    const isColour = (v: string) => /^(#|rgb|hsl|oklch|oklab|color\()/i.test(v.trim());
    const base = (tokens?.vars?.[dark ? 'dark' : 'light'] ?? {}) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(base)) if (typeof v === 'string' && isColour(v)) out[k] = v;
    return { ...out, ...tokenVars };
  }, [tokens, dark, tokenVars]);

  /**
   * The classes that make the selected component look like it is in `forcedState`.
   *
   * Read off the resolved CVA string for the chosen combination, with the `hover:` /
   * `active:` modifier stripped — see `forcedStateClasses`. Hoisted out of the JSX
   * because the safelist effect below needs the same value.
   */
  const previewForced = useMemo(() => {
    if (!forcedState || !component?.cva) return undefined;
    const resolved = [
      component.cva.base.classes,
      ...Object.entries(component.cva.axes).map(
        ([axis, values]) =>
          values[variantState[axis] ?? component.cva?.defaults[axis] ?? Object.keys(values)[0]]
            ?.classes ?? '',
      ),
    ].join(' ');
    return forcedStateClasses(resolved, forcedState).join(' ') || undefined;
  }, [component, forcedState, variantState]);

  /*
   * REGISTER THE FORCED-STATE CLASSES AS TAILWIND CANDIDATES.
   *
   * `forcedStateClasses` turns `hover:bg-primary/90` into `bg-primary/90` so it applies
   * with no pointer. That class exists in NO source file — the only spelling anyone
   * wrote is the `hover:` one — so Tailwind never emitted a rule for it and the forced
   * state changed the class attribute while changing nothing on screen.
   *
   * The safelist endpoint exists for exactly this: classes the editor composes at
   * runtime. Same mechanism the class editor already uses for a colour it builds from a
   * role and an opacity.
   */
  useEffect(() => {
    const forced = previewForced;
    if (!forced) return;
    void bridge.candidates(forced.split(/\s+/).filter(Boolean)).catch(() => {
      /* a safelist miss shows as an unstyled state, not as a broken editor */
    });
  }, [bridge, previewForced]);

  /**
   * PUBLISH THE STAGED PLAN TO THE FRAME, so a class edit is visible before it is written.
   *
   * The pipeline for this shipped at both ends and was never connected: `POST /plan` stores
   * the intents and `plugin/scene-patch.ts` serves the frame's modules with them applied.
   * Nothing called the route, so the frame kept painting the committed state and the whole
   * point of staging — try it, then decide — did not hold for classes. Token edits were
   * never affected: a CSS variable can be pushed into a frame from outside, and
   * `wb:set-token-vars` does exactly that.
   *
   * `apply` items only. A `revert` is history having moved back PAST the last save, so disk
   * carries something the present state does not; the frame renders the present, and
   * sending the revert would ask it to paint the write rather than the intent.
   *
   * Sent on every staging change INCLUDING the empty one. An emptied plan is what makes
   * undo visible — the route reloads the union of the old plan's files and the new one's,
   * so the last edit dropping out is the case that reverts the frame. Skipping the empty
   * send would leave the last patch on screen forever.
   */
  useEffect(() => {
    if (!sceneId) return;
    let live = true;
    const intents = plan.filter((p) => p.mode === 'apply').map((p) => p.intent);
    void bridge
      .plan('after', intents)
      .then((r) => {
        // A refusal here is not fatal — the edit is still staged and Save still works —
        // but it means what you are looking at is not what you staged, and silence about
        // that is worse than the stale pixels.
        if (live && r && 'ok' in r && !r.ok) {
          notify('error', 'Preview not updated', r.error ?? 'The frame could not be updated.');
        }
      })
      .catch(() => {
        if (live) notify('error', 'Preview not updated', 'The bridge did not answer.');
      });
    return () => {
      live = false;
    };
  }, [plan, sceneId, bridge, notify]);

  /**
   * ⌘S opens the REVIEW, it does not write.
   *
   * 11b wrote the plan straight through because the modal was PR 12's; this is that PR. The
   * difference is not ceremony — the modal dry-runs every intent and shows the diff, which is
   * the only place a designer sees what a class rewrite will do to source before it happens.
   */
  const save = useCallback(() => {
    if (!plan.length || busy) return;
    setReviewOpen(true);
  }, [plan, busy]);

  /** Called by the modal once a commit actually landed. */
  const onApproved = useCallback(() => {
    history.markSaved();
    setStaleKeys({});
    refreshMetadata();
    refreshTokens();
    refreshWriteLog();
  }, [history, refreshMetadata, refreshTokens, refreshWriteLog]);

  /** Stepping the bridge's transaction log changes FILES, so the baseline moves too. */
  const stepWrite = async (dir: 'revert' | 'reapply') => {
    setBusy(true);
    const r = await (dir === 'revert' ? bridge.undo() : bridge.redo());
    setBusy(false);
    if (r.ok) {
      if (dir === 'revert') history.rollbackBaseline();
      else history.markSaved();
      notify('info', dir === 'revert' ? 'Reverted the last write' : 'Re-applied the write');
    } else {
      notify('error', `Could not ${dir} that write`, r.error ?? 'A file changed since it was written.');
    }
    refreshWriteLog();
    // Files moved, so the node trees moved with them — reverting a `layout-insert`
    // renumbers every following sibling back, and any staged anchor below it is
    // describing the wrong node until this rebases it.
    refreshMetadata();
  };

  // --- Keyboard: the editor conventions the frame analogy implies. ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      const el = e.target as HTMLElement | null;
      const inText =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true);
      if (k === 's') {
        e.preventDefault(); // never let the browser's Save Page dialog win
        save();
      } else if (k === 'z' && !inText) {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (k === 'y' && !inText) {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, save]);

  /**
   * Register the classes the frame painted as Tailwind candidates.
   *
   * NOT cosmetic, and it is easy to drop while porting: Tailwind only emits a rule for a
   * class it saw in source, and a class this editor composes at runtime — the whole point
   * of the floating class editor — exists nowhere in source yet. Without this, adding
   * `gap-4` stages an edit, previews as nothing, and looks like the editor is broken.
   *
   * Sent as a set difference rather than the whole list on every frame message: the frame
   * re-reports its classes on each patch, and re-sending an unchanged list would make the
   * bridge rewrite its safelist on every keystroke.
   */
  const sentCandidates = useRef<Set<string>>(new Set());
  const registerCandidates = useCallback(
    (classes: string[]) => {
      const fresh = classes.filter((c) => !sentCandidates.current.has(c));
      if (!fresh.length) return;
      for (const c of fresh) sentCandidates.current.add(c);
      bridge.candidates(fresh);
    },
    [bridge],
  );

  const staleCount = Object.keys(staleKeys).length;

  return (
    <div className={cn('h-full', dark && 'dark')}>
      <div className="flex h-full flex-col bg-wb-bg text-wb-fg">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-wb-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-wb-accent text-wb-accent-fg">
              <Palette className="size-3.5" />
            </span>
            <span className="text-sm font-semibold">Design editor</span>
            {health && !health.ok && (
              <span className="rounded-full bg-wb-danger/20 px-2 py-0.5 text-[10px] text-wb-danger">
                bridge unreachable
              </span>
            )}
            {history.restored && (
              <span
                title="Staged edits were restored from this dev-server session"
                className="rounded-full bg-wb-border px-2 py-0.5 text-[10px] text-wb-muted"
              >
                restored
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <HeaderButton
              onClick={() => setDark((d) => !d)}
              title={dark ? 'Switch the frame to light' : 'Switch the frame to dark'}
              label={dark ? 'Light' : 'Dark'}
              icon={dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            />
            <HeaderButton
              onClick={history.undo}
              disabled={!history.canUndo}
              title={`Undo the last edit · ⌘Z${history.undoDepth ? ` (${history.undoDepth})` : ''}`}
              label="Undo"
              icon={<ChevronLeft className="size-3.5" />}
            />
            <HeaderButton
              onClick={history.redo}
              disabled={!history.canRedo}
              title="Redo · ⇧⌘Z"
              label="Redo"
              icon={<ChevronRight className="size-3.5" />}
            />

            {staleCount > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title="Edits that can no longer be applied"
                    className="rounded-full bg-wb-danger/20 px-2 py-0.5 text-[10px] text-wb-danger"
                  >
                    {staleCount} stale
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80" label="Stale edits">
                  <p className="mb-1 text-[10px] text-wb-muted">
                    The file changed under these edits, so the text they expect to find is
                    gone. Discarding is the only recovery — the old value no longer
                    describes the file.
                  </p>
                  <ul className="flex flex-col gap-1">
                    {Object.entries(staleKeys).map(([k, why]) => (
                      <li key={k} className="font-mono text-[10px] text-wb-muted">
                        {k.split('|')[1]} — {why}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => {
                      history.dropEdits(
                        Object.keys(staleKeys).map((k) => {
                          const [map, key] = k.split('|');
                          return { map: map as keyof EditState, key };
                        }),
                      );
                      setStaleKeys({});
                    }}
                    className="mt-2 w-full rounded-sm border border-wb-border px-2 py-1 text-[10px] text-wb-muted hover:bg-wb-subtle hover:text-wb-fg"
                  >
                    Discard them
                  </button>
                </PopoverContent>
              </Popover>
            )}

            {/*
              THE CONFIG READOUT, moved rather than deleted.
              
              It was 11a's whole screen and 11a's header said it survives: "is my config
              actually wired?" is the first question a consumer has, and §5 calls the answer
              the real onboarding cliff. 12 needed the tab it was standing in, so it moves
              here — the four facts a missing manifest or absent adapter gets wrong, one
              click away, instead of gone.
            */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="What the plugin found in this project"
                  className="inline-flex items-center gap-1.5 rounded-md border border-wb-border px-2.5 py-1 text-xs text-wb-muted hover:bg-wb-subtle hover:text-wb-fg"
                >
                  <Info className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-96">
                <dl className="flex flex-col gap-1 text-[10px]">
                  <Readout label="Editing" value={health?.root ?? '(unreported)'} />
                  <Readout
                    label="Scene manifest"
                    value={health?.scenes ?? 'none declared'}
                    ok={!!health?.scenes}
                  />
                  <Readout
                    label="Token adapter"
                    value={
                      tokens?.adapter === 'configured'
                        ? `configured · ${tokens.families?.length ?? 0} families`
                        : (tokens?.reason ?? 'none — the token panels are read-only')
                    }
                    ok={tokens?.adapter === 'configured'}
                  />
                  <Readout
                    label="Aliases"
                    value={
                      health?.aliases?.length
                        ? health.aliases.map((a) => `${a.find} → ${a.replacement || '.'}`).join('  ')
                        : 'none configured'
                    }
                  />
                </dl>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="Writes on disk, newest first"
                  aria-label={`Write log (${writeDepth} on disk)`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-wb-border px-2.5 py-1 text-xs text-wb-muted hover:bg-wb-subtle hover:text-wb-fg"
                >
                  <ScrollText className="size-3.5" />
                  {writeDepth}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80" label="Write log">
                <p className="mb-1 text-[10px] font-medium text-wb-muted">Write log</p>
                {writeLog.length === 0 ? (
                  <p className="text-[10px] text-wb-muted">Nothing written this session.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {writeLog.map((t) => (
                      <li key={t.id} className="font-mono text-[10px] text-wb-muted">
                        #{t.id} {t.labels.join(', ')}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => stepWrite('revert')}
                    disabled={busy || writeDepth === 0}
                    className="flex-1 rounded-sm border border-wb-border px-2 py-1 text-[10px] text-wb-muted hover:bg-wb-subtle hover:text-wb-fg disabled:pointer-events-none disabled:opacity-50"
                  >
                    Revert last
                  </button>
                  <button
                    type="button"
                    onClick={() => stepWrite('reapply')}
                    disabled={busy || reapplyDepth === 0}
                    className="flex-1 rounded-sm border border-wb-border px-2 py-1 text-[10px] text-wb-muted hover:bg-wb-subtle hover:text-wb-fg disabled:pointer-events-none disabled:opacity-50"
                  >
                    Re-apply
                  </button>
                </div>
              </PopoverContent>
            </Popover>

            <HeaderButton
              onClick={history.clear}
              disabled={!history.dirty && history.undoDepth === 0}
              title="Discard every staged edit (undoable)"
              label="Reset"
              icon={<RotateCcw className="size-3.5" />}
            />
            <button
              type="button"
              onClick={save}
              disabled={plan.length === 0 || busy}
              title={
                plan.length
                  ? 'Review the plan and write it · ⌘S'
                  : 'Nothing to write — code matches the editor'
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-wb-accent px-2.5 py-1 text-xs font-medium text-wb-accent-fg transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
            >
              <HardDriveDownload className="size-3.5" />
              Save to Code
              {/*
                ALWAYS RENDERED, AT A FIXED WIDTH. Hiding it at zero and letting it grow
                past nine made the button change size twice — so every control to its
                left slid sideways on the first staged edit and again on the tenth. A
                toolbar that moves while you use it is harder to hit than one that shows
                a zero. `tabular-nums` keeps 11 the same width as 88.
              */}
              <span className="min-w-[1.25rem] rounded-full bg-wb-bg/20 px-1.5 text-center text-[10px] tabular-nums">
                {plan.length > 99 ? '99+' : plan.length}
              </span>
            </button>
          </div>
        </header>

        {notices.length > 0 && (
          <div className="shrink-0 border-b border-wb-border px-4 py-1.5">
            {notices.map((n) => (
              <p
                key={n.id}
                className={cn('text-[11px]', n.kind === 'error' ? 'text-wb-danger' : 'text-wb-muted')}
              >
                <span className="font-medium">{n.title}</span>
                {n.detail ? ` — ${n.detail}` : ''}
              </p>
            ))}
          </div>
        )}

        {/*
          THE SIDE PANES ARE DRAGGABLE, and the centre takes what is left.
          
          Fixed at 220 / 340 the panes were a compromise nobody chose: the catalogue is a
          column of module names that wants to be narrow, the bindings panel is rows of
          label + control + swatch that wants to be wide, and which one you need depends
          on what you are doing rather than on the app. Only the two side columns are
          stateful — the centre is `1fr`, so the preview keeps every pixel the panes give
          back, which is the direction that matters.
        */}
        <div
          className="grid min-h-0 flex-1 gap-1 p-3"
          style={{ gridTemplateColumns: `${paneWidth.left}px 6px 1fr 6px ${paneWidth.right}px` }}
        >
          <aside className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border border-wb-border bg-wb-panel p-3">
            {/*
              THE MODE SWITCH. Which subject the editor is addressing — see `mode`.
              A component with no CVA still lists, because "no variants" is a fact about
              the component worth seeing, not a reason to hide it from its own list.
            */}
            <div className="flex shrink-0 gap-1 rounded-md bg-wb-bg p-0.5">
              {(['components', 'scenes'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  disabled={m === 'components' && allComponents.length === 0}
                  title={
                    m === 'components' && allComponents.length === 0
                      ? 'No components with extractable metadata in this project'
                      : undefined
                  }
                  className={cn(
                    'flex-1 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors',
                    m === mode
                      ? 'bg-wb-accent/12 text-wb-accent'
                      : 'text-wb-muted enabled:hover:text-wb-fg disabled:opacity-40',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              hidden={mode !== 'scenes'}
            >
              {scenes.length === 0 ? (
                <p className="px-1 text-[11px] leading-relaxed text-wb-muted">
                  {meta && !meta.ok
                    ? meta.error
                    : 'No scenes declared. Point the plugin at a scene manifest to render this project’s own routes.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {scenes.map((s) => (
                    <li key={s.id}>
                      {/*
                        A DEFERRED scene is shown and disabled, not hidden and not clickable.
                        Hiding it would make a scene the project declares look undeclared;
                        offering it opens a frame that can only report a manifest error. The
                        title says which of the two states this is.
                      */}
                      <button
                        type="button"
                        disabled={!!s.deferred}
                        title={
                          s.deferred
                            ? 'Declared but not mountable yet — it needs something the frame does not have (providers, a mocked store)'
                            : (s.route ?? s.file)
                        }
                        onClick={() => setSceneId(s.id)}
                        className={cn(
                          'w-full rounded-sm px-2 py-1.5 text-left text-xs transition-colors',
                          s.deferred
                            ? 'cursor-not-allowed text-wb-muted opacity-45'
                            : s.id === sceneId
                              ? 'bg-wb-accent/15 text-wb-accent'
                              : 'text-wb-muted hover:bg-wb-subtle hover:text-wb-fg',
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="truncate">{s.label}</span>
                          {s.deferred && (
                            <span className="shrink-0 rounded-full bg-wb-border px-1.5 text-[9px]">
                              not ready
                            </span>
                          )}
                        </span>
                        <span className="block truncate font-mono text-[10px] opacity-60">
                          {s.route ?? s.file}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/*
              THE COMPONENT LIST — the whole left pane in `components` mode.

              ONE DELIBERATE DIVERGENCE from the recipe, which pairs this mode with a
              `PreviewPane` rendering the selected primitive in isolation. That preview
              needs a hand-written renderer PER COMPONENT: the prototype's registry
              carried two of them (Button, Badge) against 25 ui components, so shipping
              the mode that way would show a preview for 2 and an empty frame for the
              rest — a coverage gap dressed as a feature.

              So the centre keeps the real page in BOTH modes. The mode still earns its
              place, because the right pane genuinely differs: a CVA value and a
              `NodeAnchor` are not the same address, and `TokenBindingPanel` describing a
              Button while a route is under edit is the thing the recipe removes it for.
            */}
            <div className="min-h-0 flex-1 overflow-y-auto" hidden={mode !== 'components'}>
              <ComponentList
                components={allComponents}
                selected={component?.name ?? ''}
                onSelect={selectComponent}
              />
            </div>
          </aside>

          <PaneHandle side="left" onDrag={setPaneWidth} />

          <main className="min-h-0 overflow-hidden rounded-lg border border-wb-border bg-wb-panel p-3">
            {sceneId ? (
              <SceneHost
                sceneId={sceneId}
                dark={dark}
                selectedId={selection?.stamp.id ?? null}
                hoverId={hoverId}
                onSelect={resolveStamp}
                onHover={(node) => setHoverId(node?.id ?? null)}
                onDeselect={() => setSelection(null)}
                onReady={(ids) => setSelectable(new Set(ids))}
                onClasses={registerCandidates}
                onMeasured={setSelectionRect}
                onSelectionHostRect={setSelectionHostRect}
                tokenVars={tokenVars}
                /*
                 * In `components` mode the centre shows the selected component across
                 * its variants. The recipe specified this and the extraction dropped it
                 * for a registry that was never needed: of the components the analyser
                 * reads, the ones with a variant table are exactly the ones that need no
                 * props, so the real component can simply be rendered.
                 *
                 * `componentFile` is required — a component with no file to import from
                 * cannot be previewed, and falling back to the scene silently would make
                 * the mode look like it did nothing.
                 */
                preview={
                  mode === 'components' && component && componentFile
                    ? {
                        file: componentFile,
                        component: component.name,
                        /*
                         * THE SELECTED COMBINATION, not the whole matrix.
                         *
                         * The variant badges above are a STATE control — they say which
                         * Button the bindings below describe. Rendering all 24 at once
                         * made the centre disagree with them: the panel spoke about
                         * `variant=default size=sm` while the pane showed every variant
                         * with equal weight, and picking a badge changed nothing you
                         * could see.
                         *
                         * Falls back to the component's OWN defaults rather than to the
                         * full matrix. `variantState` is seeded on click, so before the
                         * first click it is empty — and showing 24 cells until you touch
                         * something, then one afterwards, would read as the pane breaking
                         * rather than as it following you.
                         */
                        /*
                         * The classes that make the component LOOK like it is in the
                         * chosen state. `forcedStateClasses` reads them off the resolved
                         * CVA string for this combination and drops the `hover:` /
                         * `active:` modifier, so they apply with no pointer and no press
                         * — the only way to sit and look at a hover style.
                         */
                        forced: previewForced,
                        /*
                         * Only the states the component AUTHORS. Read off the resolved
                         * class string: `STATES` is the vocabulary, and a state with no
                         * `hover:`/`disabled:` rule in this component has nothing to show.
                         */
                        states: STATES.map((st) => st.key).filter((st) =>
                          forcedStateClasses(
                            [
                              component.cva?.base.classes ?? '',
                              ...Object.values(component.cva?.axes ?? {}).flatMap((vals) =>
                                Object.values(vals).map((v) => v.classes),
                              ),
                            ].join(' '),
                            st,
                          ).length > 0,
                        ),
                        forcedState,
                        label: previewLabel || undefined,
                        mockProps: mockProps ?? undefined,
                        noopProps: noopPropsFor(component.props ?? []),
                        iconSlot,
                        icon,
                        // The chooser: every value of every axis. `axes` above is the
                        // single choice the frame renders.
                        allAxes: Object.fromEntries(
                          Object.entries(component.cva?.axes ?? {}).map(([axis, values]) => [
                            axis,
                            Object.keys(values),
                          ]),
                        ),
                        axes: Object.fromEntries(
                          Object.entries(component.cva?.axes ?? {}).map(([axis, values]) => [
                            axis,
                            [
                              variantState[axis] ??
                                component.cva?.defaults[axis] ??
                                Object.keys(values)[0],
                            ],
                          ]),
                        ),
                      }
                    : undefined
                }
                onForcedStateChange={(st) => setForcedState(st as StateKey | null)}
                onVariantChange={(axis, value) =>
                  setVariantState((prev) => ({ ...prev, [axis]: value }))
                }
                mockDataEmpty={mockDataEmpty}
                onMockDataEmptyChange={setMockDataEmpty}
              />
            ) : scenes.length > 0 ? (
              // The manifest DID arrive; every scene in it is deferred. Saying "waiting"
              // here names the wrong cause and leaves the user waiting for something that
              // already happened.
              <p className="p-2 text-[11px] text-wb-muted">
                Every scene in this manifest is <span className="font-code">deferred</span>, so
                there is nothing to mount. Drop <span className="font-code">deferred</span> on a
                scene to open it here.
              </p>
            ) : (
              <p className="p-2 text-[11px] text-wb-muted">
                Waiting for the scene manifest…
              </p>
            )}
          </main>

          {classEditTarget && selectionRect && !classEditorClosed && selection && (
            <FloatingClassEditor
              // Keyed on the SELECTION, not the scene: a new node remounts the panel
              // with a fresh drag offset, while the same node's rect updating from a
              // scroll or zoom re-renders it in place — a panel dragged out of the way
              // must not snap back on the next scroll tick.
              key={selection.stamp.id}
              hostRect={selectionHostRect}
              classes={classEditTarget.effective}
              title={`<${selection.stamp.tag}>`}
              onChange={(next) =>
                onLayoutClassEdit(
                  classEditTarget.anchor,
                  selection.stamp.component,
                  classEditTarget.baseClasses,
                  next,
                )
              }
              onClose={() => setClassEditorClosed(true)}
            />
          )}

          <ReviewApproveModal
            open={reviewOpen}
            onOpenChange={setReviewOpen}
            dark={dark}
            plan={plan}
            classEdits={Object.values(history.state.classEdits)}
            tokenEdits={Object.values(history.state.tokenEdits)}
            tokenAdds={Object.values(history.state.tokenAdds)}
            rebinds={Object.values(history.state.rebinds)}
            paletteEdits={Object.values(history.state.paletteEdits)}
            layoutEdits={Object.values(history.state.layoutEdits)}
            tokens={tokens}
            bridge={bridge}
            allComponents={allComponents}
            onApproved={onApproved}
            onDiscard={history.dropEdits}
            notify={notify}
          />

          <PaneHandle side="right" onDrag={setPaneWidth} />

          <aside className="min-h-0 overflow-hidden rounded-lg border border-wb-border bg-wb-panel p-3">
            {/*
              TWO TABS PER MODE, not three in one group.

              `Layout` addresses a `NodeAnchor` in the scene under edit and `Bindings`
              addresses one component's CVA, so exactly one of them has a subject at any
              moment; offering both left the other describing something nobody selected.
              `Tokens` is in both on purpose — it edits the stylesheet, whose blast radius
              is every scene as much as every component, and judging a semantic colour on
              a real page is the most valuable thing this tool does.

              KEYED BY MODE so the group remounts: `defaultValue` is read once, and
              switching modes retires the active tab's trigger. Without the key the group
              would hold a `value` naming a tab that no longer exists and render no
              content at all.
            */}
            <Tabs
              key={mode}
              defaultValue="layout"
              className="flex h-full flex-col gap-3"
            >
              <TabsList className="w-full">
                {/*
                  LAYOUT IS IN BOTH MODES NOW.
                  
                  Picking inside the component pane and panning it are the same gesture —
                  a drag — so one always cost the other, and picking also had no way to
                  show WHAT it had selected. The outline answers both: it lists the
                  component's own tree, the selected row is visibly selected, and it
                  drives the same class editor a scene click does. That is how a
                  component with no variants gets restyled.
                */}
                <TabsTrigger
                  value="layout"
                  className="flex-1 data-[state=active]:bg-wb-accent/12 data-[state=active]:text-wb-accent"
                >
                  Layout
                </TabsTrigger>
                {mode === 'components' && (
                  <TabsTrigger
                    value="bindings"
                    className="flex-1 data-[state=active]:bg-wb-accent/12 data-[state=active]:text-wb-accent"
                  >
                    Bindings
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="tokens"
                  className="flex-1 data-[state=active]:bg-wb-accent/12 data-[state=active]:text-wb-accent"
                >
                  Tokens
                </TabsTrigger>
              </TabsList>

              <TabsContent value="layout" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                {/*
                  A COMPOSITE'S PARTS ARE ITS LAYOUT, and this is where you look for it.
                  
                  The outline below lists the JSX a component RETURNS, which for a
                  composite root is almost nothing: `Card` renders one `div`, and its
                  header, body and footer are sibling exports rather than children. So
                  the tab showed `card.tsx / Card / div` and stopped — a structure panel
                  reporting that the thing has no structure.
                  
                  They used to fold out of the left list, which put the anatomy in the
                  catalogue and left this tab empty. One click still switches the preview
                  to a part; it just lives beside the tree it belongs to.
                */}
                {componentRoot && (
                  <button
                    type="button"
                    onClick={() => selectComponent(componentRoot.name)}
                    title={`Back to ${componentRoot.name}`}
                    className="flex shrink-0 items-center gap-1 rounded-sm px-1 py-1 text-left font-mono text-[10px] uppercase tracking-wide text-wb-muted transition-colors hover:text-wb-fg"
                  >
                    <ChevronLeft className="size-3 shrink-0" />
                    part of {componentRoot.name}
                  </button>
                )}
                {componentParts.length > 0 && (
                  <div className="shrink-0 border-b border-wb-border pb-2">
                    <p className="mb-1 px-1 font-mono text-[10px] uppercase tracking-wide text-wb-muted">
                      {component?.name} is assembled from
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {componentParts.map((c) => (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => selectComponent(c.name)}
                          title={`Preview ${c.name} on its own`}
                          className="rounded-md bg-wb-subtle px-1.5 py-0.5 font-mono text-[10px] text-wb-muted transition-colors hover:bg-wb-accent/12 hover:text-wb-accent"
                        >
                          {c.name.startsWith(component?.name ?? '')
                            ? c.name.slice((component?.name ?? '').length)
                            : c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-hidden">
                  <SceneOutline
                    trail={trail}
                    selectable={selectable}
                    selectedId={selection?.stamp.id ?? null}
                    hoverId={hoverId}
                    onSelect={selectFromOutline}
                    onHover={setHoverId}
                    onDrillIn={(f) => void drillInto(f)}
                    onTrailTo={(i) => setDrillTrail((prev) => prev.slice(0, i))}
                    fileOfTag={fileOfTag}
                    /*
                     * The composite's own prefix is dropped, so its parts read `Header`
                     * and `Title` under a pane that already says `Card`. Only in
                     * components mode: in a scene the root names are the file's
                     * components and there is no prefix to be redundant with.
                     */
                    labelOf={
                      mode === 'components' && componentParts.length > 0 && component
                        ? (n) => (n === component.name ? n : n.replace(component.name, '') || n)
                        : undefined
                    }
                  />
                </div>
                <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-wb-border pt-2">
                  <SceneNodeDetail
                    selection={selection}
                    visibleRect={selectionRect}
                    onPickCandidate={(path) =>
                      selection &&
                      selectFromOutline(stampId(selection.stamp.file, selection.stamp.component, path))
                    }
                  />
                </div>
              </TabsContent>

              <TabsContent value="bindings" className="min-h-0 flex-1 overflow-y-auto">
                {/*
                  PREVIEW DATA SITS ABOVE THE BINDINGS.
                  
                  For a component with no CVA this tab said "no variant-scoped bindings"
                  and stopped, which is most components — and those are exactly the ones
                  that need data before they render at all. Same tab, because both answer
                  "how is this component configured".
                */}
                {component && (
                  <PreviewDataPanel
                    component={component}
                    label={previewLabel}
                    onLabelChange={setPreviewLabel}
                    values={mockProps ?? {}}
                    onChange={setMockProps}
                    iconSlot={iconSlot}
                    onIconSlotChange={setIconSlot}
                    icon={icon}
                    onIconChange={setIcon}
                  />
                )}
                {component ? (
                  <TokenBindingPanel
                    component={component}
                    variantState={variantState}
                    forcedState={forcedState}
                    families={tokens?.families ?? []}
                    vocabulary={vocabulary}
                    /*
                     * Roles that exist in source but not in the semantic family's own keys.
                     * Empty: `SEMANTIC_VOCABULARY` already reads the adapter's live keys, so
                     * there is nothing left for a second list to add. The prop stays because
                     * a consumer whose vocabulary is curated rather than derived needs it.
                     */
                    extraRoles={[]}
                    classEdits={history.state.classEdits}
                    /*
                     * THE FILE IS STAMPED IN HERE, and nowhere else was doing it.
                     *
                     * `TokenBindingPanel` builds every class edit with `file: ''` and a
                     * comment saying the layout fills it in — a component from the
                     * recipe that this shell never grew. So `toClassIntent` shipped an
                     * empty path: `scene-patch` matched no file and the preview never
                     * repainted, which read as "changing a binding does nothing", and a
                     * Save would have had nothing to locate either. The panel edits the
                     * SELECTED component, so its file is the answer.
                     */
                    onClassEdit={(key, edit) =>
                      setIn(
                        'classEdits',
                        key,
                        edit && componentFile ? { ...edit, file: componentFile } : edit,
                        `class|${key}`,
                      )
                    }
                    onTokenAdd={(key, add) => setIn('tokenAdds', key, add)}
                    tokenAdds={history.state.tokenAdds}
                    existingRoles={existingRoles}
                    dark={dark}
                    tokenStyle={swatchVars}
                  />
                ) : (
                  <p className="px-1 text-[11px] leading-relaxed text-wb-muted">
                    No components analysed. List them under `components` in the scene manifest
                    to edit their CVA values here.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="tokens" className="min-h-0 flex-1 overflow-hidden">
                <TokenEditorPanel
                  dark={dark}
                  tokens={tokens}
                  tokenEdits={history.state.tokenEdits}
                  onTokenEdit={(key, edit) => setIn('tokenEdits', key, edit, `token|${key}`)}
                  tokenAdds={history.state.tokenAdds}
                  onTokenAdd={(key, add) => setIn('tokenAdds', key, add)}
                  rebinds={history.state.rebinds}
                  onRebind={(key, edit) => setIn('rebinds', key, edit)}
                  paletteEdits={history.state.paletteEdits}
                  onPaletteEdit={(key, edit) => setIn('paletteEdits', key, edit, `palette|${key}`)}
                />
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * A drag handle between two panes.
 *
 * `pointer` events with capture, not `mousemove` on `window`: the pointer leaves this
 * 6px strip on the first frame of any real drag, and a mouse-based version dropped the
 * gesture the moment it crossed onto the iframe — which is most of the screen. Capture
 * keeps the events coming to the element that started it.
 *
 * The bounds are the panes' own minimums, not the window's: below ~160px the catalogue's
 * module rows truncate to nothing, and above ~560px the centre stops being the subject.
 */
function PaneHandle({
  side,
  onDrag,
}: {
  side: 'left' | 'right';
  onDrag: (next: (prev: { left: number; right: number }) => { left: number; right: number }) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        let start = 0;
        onDrag((prev) => {
          start = side === 'left' ? prev.left : prev.right;
          return prev;
        });
        const move = (ev: PointerEvent) => {
          // The right pane grows as the pointer moves LEFT, so its delta is inverted.
          const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
          const next = Math.max(160, Math.min(560, start + delta));
          onDrag((prev) => ({ ...prev, [side]: next }));
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
      className="group flex cursor-col-resize items-center justify-center"
    >
      <div className="h-10 w-0.5 rounded-full bg-wb-border transition-colors group-hover:bg-wb-accent" />
    </div>
  );
}

function HeaderButton({
  onClick,
  disabled,
  title,
  label,
  icon,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-md border border-wb-border px-2.5 py-1 text-xs text-wb-muted transition-colors hover:bg-wb-subtle hover:text-wb-fg disabled:pointer-events-none disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

/** One `label: value` line, with the value's own verdict colour. */
function Readout({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-wb-muted">{label}</dt>
      <dd className={cn('font-mono break-all', ok === false ? 'text-wb-danger' : 'text-wb-fg')}>
        {value}
      </dd>
    </div>
  );
}
