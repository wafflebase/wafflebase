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
import { ReviewApproveModal } from './panels/ReviewApproveModal.tsx';
import { TokenBindingPanel } from './panels/TokenBindingPanel.tsx';
import { TokenEditorPanel } from './panels/TokenEditorPanel.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx';
import { sceneNodeAt, type FileMeta, type SceneMeta } from '../types.ts';
import { stampId, type FrameRect, type StampRef } from '../scenes/frame-protocol.ts';
import { resolveImport } from '../scenes/import-paths.ts';

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

/** View state worth surviving a reload, but NOT part of the undo history. */
const VIEW_KEY = 'design-editor:view:v1';
interface ViewState {
  dark: boolean;
  scene: string;
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
  const [reviewOpen, setReviewOpen] = useState(false);

  const onHistoryReset = useCallback(
    () => notify('info', 'Dev server restarted', 'The persisted edit history was cleared.'),
    [notify],
  );
  const history = useEditHistory(health?.ok ? (health.session ?? null) : null, onHistoryReset);
  const { layoutEdits } = history.state;

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify({ dark, scene: sceneId } satisfies ViewState));
    } catch {
      /* a disabled store just means the view does not survive a reload */
    }
  }, [dark, sceneId]);

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
  const files: FileMeta[] = useMemo(() => meta?.metadata?.files ?? [], [meta]);
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
  const allComponents = useMemo(
    () => files.flatMap((f) => f.components ?? []),
    [files],
  );
  const component = allComponents.find((c) => c.name === componentName) ?? allComponents[0];
  /** Re-seed the variant axes when the selection changes; edits are keyed per component. */
  const selectComponent = (name: string) => {
    const next = allComponents.find((c) => c.name === name);
    if (!next) return;
    setComponentName(name);
    setVariantState(defaultVariantState(next));
  };

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
    const out: OutlineFile[] = [];
    if (activeScene) out.push({ file: activeScene.file, roots: activeScene.roots });
    for (const f of drillTrail) {
      const h = holderOf(f);
      if (h) out.push({ file: f, roots: h.roots });
    }
    return out;
  }, [activeScene, drillTrail, holderOf]);

  /**
   * tag → the file that tag's component lives in, through the scene's own import list
   * and the consumer's own aliases. A project whose alias is `~` or `#app` resolves
   * here exactly as `@` does; a tag with no matching import is not drillable.
   */
  const fileOfTag = useCallback(
    (tag: string): string | null => {
      if (!activeScene) return null;
      const imported = activeScene.imports?.find((i) => i.default === tag || i.named?.includes(tag));
      if (!imported) return null;
      const resolved = resolveImport(activeScene.file, imported.module, health?.aliases ?? []);
      // Only offer a drill-in for a file the analyser actually read: otherwise the
      // breadcrumb pushes a file whose tree is empty, which reads as a component with
      // no nodes rather than as one nobody declared.
      return resolved && files.some((f) => f.file === resolved) ? resolved : null;
    },
    [activeScene, files, health],
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
    (stamp: StampRef) => {
      const holder = holderOf(stamp.file);
      if (!holder) {
        // A click can land in a file no scene declares — an app shell paints its
        // layout and sidebar into the same frame. Report which file, because "click
        // did nothing" is the unhelpful version of this.
        setSelection({
          stamp,
          reason: `${stamp.file} was not analysed, so this click has no source anchor. Declare it as a component in the scene manifest.`,
        });
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
    [holderOf, syncTrailTo],
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
                    className="mt-2 w-full rounded-sm border border-wb-border px-2 py-1 text-[10px] text-wb-muted hover:bg-wb-accent hover:text-wb-accent-fg"
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
                  className="inline-flex items-center gap-1.5 rounded-md border border-wb-border px-2.5 py-1 text-xs text-wb-muted hover:bg-wb-accent hover:text-wb-accent-fg"
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
                  className="inline-flex items-center gap-1.5 rounded-md border border-wb-border px-2.5 py-1 text-xs text-wb-muted hover:bg-wb-accent hover:text-wb-accent-fg"
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
                    className="flex-1 rounded-sm border border-wb-border px-2 py-1 text-[10px] text-wb-muted hover:bg-wb-accent hover:text-wb-accent-fg disabled:pointer-events-none disabled:opacity-50"
                  >
                    Revert last
                  </button>
                  <button
                    type="button"
                    onClick={() => stepWrite('reapply')}
                    disabled={busy || reapplyDepth === 0}
                    className="flex-1 rounded-sm border border-wb-border px-2 py-1 text-[10px] text-wb-muted hover:bg-wb-accent hover:text-wb-accent-fg disabled:pointer-events-none disabled:opacity-50"
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
              {plan.length > 0 && (
                <span className="rounded-full bg-wb-bg/20 px-1.5 text-[10px]">{plan.length}</span>
              )}
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

        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_340px] gap-3 p-3">
          <aside className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border border-wb-border bg-wb-panel p-3">
            <p className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-wb-muted">
              Scenes
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto">
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
                              : 'text-wb-muted hover:bg-wb-accent hover:text-wb-accent-fg',
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
              THE COMPONENT LIST IS HERE, not behind a mode toggle.
              
              The prototype made components a MODE that replaced the centre pane with an
              isolated preview of one primitive. That preview needs a hand-written renderer
              per component and is not part of this rollout, so the centre stays the real
              page — which is the better surface for judging a token change anyway. What the
              list is for is giving "Token bindings" a subject: it edits one component's CVA
              values, and nothing else on screen names a component.
            */}
            {allComponents.length > 0 && (
              <div className="min-h-0 shrink-0 border-t border-wb-border pt-2" style={{ maxHeight: '45%' }}>
                <div className="max-h-40 overflow-y-auto">
                  <ComponentList
                    components={allComponents}
                    selected={component?.name ?? ''}
                    onSelect={selectComponent}
                  />
                </div>
              </div>
            )}
          </aside>

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

          <aside className="min-h-0 overflow-hidden rounded-lg border border-wb-border bg-wb-panel p-3">
            <Tabs defaultValue="layout" className="flex h-full flex-col gap-3">
              <TabsList className="w-full">
                <TabsTrigger
                  value="layout"
                  className="flex-1 data-[state=active]:bg-wb-accent data-[state=active]:text-wb-accent-fg"
                >
                  Layout
                </TabsTrigger>
                <TabsTrigger
                  value="bindings"
                  className="flex-1 data-[state=active]:bg-wb-accent data-[state=active]:text-wb-accent-fg"
                >
                  Bindings
                </TabsTrigger>
                <TabsTrigger
                  value="tokens"
                  className="flex-1 data-[state=active]:bg-wb-accent data-[state=active]:text-wb-accent-fg"
                >
                  Tokens
                </TabsTrigger>
              </TabsList>

              <TabsContent value="layout" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <SceneOutline
                    trail={trail}
                    selectable={selectable}
                    selectedId={selection?.stamp.id ?? null}
                    hoverId={hoverId}
                    onSelect={selectFromOutline}
                    onHover={setHoverId}
                    onDrillIn={syncTrailTo}
                    onTrailTo={(i) => setDrillTrail((prev) => prev.slice(0, i))}
                    fileOfTag={fileOfTag}
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

              <TabsContent value="bindings" className="min-h-0 flex-1 overflow-hidden">
                {component ? (
                  <TokenBindingPanel
                    component={component}
                    variantState={variantState}
                    onVariantChange={(axis, value) =>
                      setVariantState((prev) => ({ ...prev, [axis]: value }))
                    }
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
                    onClassEdit={(key, edit) => setIn('classEdits', key, edit, `class|${key}`)}
                    onTokenAdd={(key, add) => setIn('tokenAdds', key, add)}
                    tokenAdds={history.state.tokenAdds}
                    existingRoles={existingRoles}
                    dark={dark}
                    tokenStyle={tokenPreviewStyle({
                      theme: dark ? 'dark' : 'light',
                      literalEdits: Object.values(history.state.tokenEdits),
                      rebinds: Object.values(history.state.rebinds),
                      paletteEdits: Object.values(history.state.paletteEdits),
                      bindings: tokens?.bindings?.themed[dark ? 'dark' : 'light'],
                    })}
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
      className="inline-flex items-center gap-1.5 rounded-md border border-wb-border px-2.5 py-1 text-xs text-wb-muted transition-colors hover:bg-wb-accent hover:text-wb-accent-fg disabled:pointer-events-none disabled:opacity-50"
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
