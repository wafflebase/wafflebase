import type { Document as YorkieDocument } from '@yorkie-js/sdk';
import {
  type ArrowheadStyle,
  type ConnectorElement,
  type ConnectorRouting,
  type Element as ModelElement,
  type ElementInit,
  type Endpoint,
  type Frame,
  type GroupElement,
  type GroupTransform,
  type Meta,
  type PlaceholderRef,
  type SlidesDocument,
  type SlidesStore,
  type Stroke,
  CURVE_BEND_MAX,
  CURVE_BEND_MIN,
  IDENTITY_GROUP_TRANSFORM,
  applyGroupTransform,
  applyGroupTransformMatrix,
  applyGroupTransformToPoint,
  applyInverseMatrix,
  applyInversePoint,
  bakeGroupScale,
  buildElementWorldLookup,
  composeAncestorTransform,
  computeConnectorFrame,
  generateId,
  groupToTransform,
  isBlocksEmpty,
  normalizeToGroupLocal,
  pushRecent,
  resolveEndpoint,
  worldTightFrame,
} from '@wafflebase/slides';
import type { Block } from '@wafflebase/docs';
import { boardToSlidesDocument } from '@wafflebase/board';
import type { YorkieBoardRoot } from '@/types/board-document';
import type { YorkieElement, YorkieGroupElement } from '@/types/slides-document';

/**
 * YorkieElements array as seen inside a doc.update callback. The Yorkie
 * proxy exposes the same JS array-like interface (push, splice, find,
 * findIndex, iteration) as a plain Element[], but its items are proxies
 * rather than plain objects. Mirrors the same-named type in
 * `yorkie-slides-store.ts`.
 */
type ProxyArray = { id: string; type: string; data?: unknown; [k: string]: unknown }[];

/**
 * Plain-value deep clone via JSON. Use for snapshot values, init payloads,
 * and any other plain-JS objects. Do NOT pass a Yorkie proxy directly: its
 * `toJSON()` returns a string, which causes JSON.stringify to double-encode.
 * Use `yorkieToPlain` for Yorkie proxies instead. Verbatim port of the
 * helper in `yorkie-slides-store.ts`.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Convert a Yorkie object/array proxy to a plain JS value. Verbatim port
 * of the helper in `yorkie-slides-store.ts`.
 */
function yorkieToPlain<T>(value: unknown): T {
  if (value && typeof value === 'object') {
    const maybeJson = (value as { toJSON?: () => string }).toJSON;
    if (typeof maybeJson === 'function') {
      const str = maybeJson.call(value);
      if (typeof str === 'string') {
        return JSON.parse(str) as T;
      }
    }
  }
  return value as T;
}

/**
 * Fully unwrap a Yorkie element proxy into a plain object preserving
 * every field. Verbatim port of the helper in `yorkie-slides-store.ts`.
 */
function unwrapElement(e: unknown): YorkieElement {
  return yorkieToPlain<YorkieElement>(e);
}

/**
 * DFS walk of a Yorkie proxy element array, invoking `visit` for every
 * element at every depth — descending into `group.data.children`, since
 * `group()` deliberately moves a connector into a group's children when
 * both its endpoints are internal to the grouped set (see `group()`
 * above). `detachConnectorsTargeting` and
 * `recomputeDependentConnectorFrames` use this (instead of a bare
 * `for (const el of r.elements)`) so a connector nested inside a group
 * is still found: a top-level-only walk would silently skip it, leaving
 * a dangling `attached` endpoint after its target is removed, or a
 * stale cached `frame` after its target moves.
 */
function walkYorkieElements(
  elements: ProxyArray,
  visit: (el: ProxyArray[number]) => void,
): void {
  for (const el of elements) {
    visit(el);
    if (el.type === 'group') {
      const children = (el.data as { children?: ProxyArray })?.children ?? [];
      walkYorkieElements(children, visit);
    }
  }
}

/**
 * DFS walk of a Yorkie proxy element array to find an element by id.
 * Returns the path (chain from root → element, leaf last) or null.
 * Verbatim port of the module-level helper in `yorkie-slides-store.ts`
 * (there it walked from a slide's `elements`; here it walks from the
 * board root's `elements` — same shape, same recursion).
 */
function yorkieFindElementPath(
  elements: ProxyArray,
  elementId: string,
): ProxyArray | null {
  for (const el of elements) {
    if (el.id === elementId) return [el];
    if (el.type === 'group') {
      const children = (el.data as { children?: ProxyArray })?.children ?? [];
      const sub = yorkieFindElementPath(children, elementId);
      if (sub) return [el, ...sub];
    }
  }
  return null;
}

/**
 * Compose the ancestor transform from the board root to the given parent
 * element. Returns the identity transform when `parentId` is '' (root).
 * Verbatim port of `yorkieResolveAncestorTransform` in
 * `yorkie-slides-store.ts` (there it walked from a slide's `elements`;
 * here it walks from the board root's `elements`).
 */
function yorkieResolveAncestorTransform(
  rootElements: ProxyArray,
  parentId: string,
): GroupTransform {
  if (parentId === '') return { ...IDENTITY_GROUP_TRANSFORM };

  const path = yorkieFindElementPath(rootElements, parentId);
  if (!path) {
    throw new Error(`[board] group(): parentId not found on board: ${parentId}`);
  }

  const groupAncestors = path
    .filter((el) => el.type === 'group')
    .map((el) => ({
      frame: yorkieToPlain<Frame>((el as unknown as { frame: unknown }).frame)!,
    } as GroupElement));

  return composeAncestorTransform(groupAncestors);
}

/**
 * Return the 4 corners of a frame (accounting for rotation around its
 * center). Verbatim port of `frameCorners` in `yorkie-slides-store.ts`.
 */
function frameCorners(frame: Frame): [number, number][] {
  const { x, y, w, h, rotation } = frame;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hw = w / 2;
  const hh = h / 2;
  return [
    [-hw, -hh],
    [+hw, -hh],
    [+hw, +hh],
    [-hw, +hh],
  ].map(([lx, ly]) => [
    cx + lx * cos - ly * sin,
    cy + lx * sin + ly * cos,
  ] as [number, number]);
}

/**
 * Thrown by every slide/theme/master/layout/animation/table method — a
 * board is one unbounded slide with no such concepts. The editor never
 * invokes these on a board (see `docs/tasks/active` Stage 3 board task
 * brief, Step 1's enumeration of the live `SlidesStore` subset).
 */
function notSupported(name: string): never {
  throw new Error(`YorkieBoardStore: "${name}" is not supported on a board`);
}

/**
 * Yorkie-backed `SlidesStore` for a board: ONE synthetic slide
 * (`SYNTHETIC_SLIDE_ID`) wrapping the board's flat `elements` array, so
 * the slides editor (~70-method `SlidesStore` surface, all keyed by
 * `slideId`) is reused unmodified. Every `slideId` argument is ignored —
 * there is exactly one plane, `root.elements` — element/connector/text/
 * guide/batch/undo methods mutate it for real; every slide/theme/master/
 * layout/animation/table method throws {@link notSupported}.
 *
 * This is a deliberate PARALLEL to `YorkieSlidesStore`, not a shared
 * base — store-abstraction unification across slides/board is an
 * explicit Non-Goal. The `batch`/`withUpdate`/undo scaffolding below is
 * ported verbatim from `yorkie-slides-store.ts` (same Yorkie
 * `doc.history` native-undo pattern); the element/connector/group/text
 * bridge bodies are ported from the same-named methods there, with the
 * `slides.find(s => s.id === slideId)` lookup dropped since there is no
 * slide array to search.
 */
export class YorkieBoardStore implements SlidesStore {
  private doc: YorkieDocument<YorkieBoardRoot>;
  /**
   * The live Yorkie root for the duration of a top-level `batch()`. See
   * `YorkieSlidesStore.activeRoot` for the full rationale — every
   * mutator routes through `withUpdate`, which runs against this root
   * instead of opening its own `doc.update`, so a batch of N mutations
   * collapses into ONE Yorkie change (one native undo unit).
   */
  private activeRoot: YorkieBoardRoot | null = null;
  /** Undo-stack depth at construction; `canUndo()` refuses to drop below it. */
  private undoFloor = 0;
  private batchDepth = 0;
  private changeListeners = new Set<() => void>();
  private unsubscribeDoc: (() => void) | undefined;
  /**
   * Memoized result of {@link read}. `read()` deep-unwraps EVERY element
   * (`yorkieToPlain` = `JSON.parse(proxy.toJSON())` per node), so on a
   * large board it rebuilds the whole document — and the editor calls it
   * at least twice per interaction frame (once in `render()`, once in
   * `repaintOverlay()`), which measured at ~25k `JSON.parse` calls and
   * ~4 MB parsed per pan frame. Holding the last snapshot collapses that
   * to one rebuild per actual change.
   *
   * The snapshot is SHARED with every caller, so it must be treated as
   * read-only; see the "READ-ONLY" notes at the legacy-group refSize
   * migration sites in `packages/slides/src/view/editor/editor.ts`.
   *
   * Dropped by {@link invalidateRead} from the two choke points through
   * which `root` can change — {@link withUpdate} (every local mutation,
   * inside or outside a `batch`) and {@link notifyChange} (remote change,
   * snapshot, undo, redo).
   */
  private cachedDoc: SlidesDocument | null = null;

  constructor(doc: YorkieDocument<YorkieBoardRoot>) {
    this.doc = doc;
    this.undoFloor = this.doc.getUndoStackForTest().length;
    this.unsubscribeDoc = doc.subscribe((e) => {
      // 'snapshot' is a DISTINCT DocEventType from 'remote-change': when
      // the server sends a whole-document snapshot (large remote catch-up)
      // the SDK emits the former and NOT the latter. It has to be handled
      // here or `root` would change with nothing dropping `cachedDoc`,
      // leaving every later `read()` permanently stale.
      if (e.type === 'remote-change' || e.type === 'snapshot') {
        this.notifyChange();
      }
    });
  }

  /** Detach from the underlying Yorkie document. Idempotent. */
  dispose(): void {
    this.unsubscribeDoc?.();
    this.unsubscribeDoc = undefined;
  }

  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => { this.changeListeners.delete(cb); };
  }

  private notifyChange(): void {
    // Drop the snapshot BEFORE the listeners run: they react by calling
    // `read()` (that is the whole point of the notification), so a stale
    // cache here would hand them the pre-change document.
    this.invalidateRead();
    for (const cb of this.changeListeners) {
      try { cb(); } catch { /* swallow listener errors */ }
    }
  }

  /** Drop the memoized {@link read} snapshot. See {@link cachedDoc}. */
  private invalidateRead(): void {
    this.cachedDoc = null;
  }

  // --- read ---

  read(): SlidesDocument {
    if (this.cachedDoc) return this.cachedDoc;
    const root = this.doc.getRoot();
    const meta = yorkieToPlain<{
      title?: string;
      unit?: 'in' | 'cm';
      recentColors?: string[];
    }>(root.meta) ?? {};
    const elements = (root.elements ?? []).map((e) => this.readElement(e));
    this.cachedDoc = boardToSlidesDocument({
      meta: {
        title: meta.title ?? 'Untitled board',
        unit: meta.unit,
        recentColors: meta.recentColors,
      },
      elements,
    });
    return this.cachedDoc;
  }

  readMeta(): Meta {
    // Skip `read()`'s full walk (which recursively unwraps every
    // element via `readElement` — expensive when called per overlay
    // render, e.g. once per drag frame). `boardToSlidesDocument`'s
    // synthesized `meta` (title/themeId/masterId/unit/recentColors)
    // never depends on `elements`, so an empty array is enough to get
    // the same `Meta` shape cheaply. Mirrors YorkieSlidesStore.readMeta,
    // which likewise skips the slide/element walk.
    const root = this.doc.getRoot();
    const meta = yorkieToPlain<{
      title?: string;
      unit?: 'in' | 'cm';
      recentColors?: string[];
    }>(root.meta) ?? {};
    return boardToSlidesDocument({
      meta: {
        title: meta.title ?? 'Untitled board',
        unit: meta.unit,
        recentColors: meta.recentColors,
      },
      elements: [],
    }).meta;
  }

  /**
   * Recursively unwrap a single Yorkie element proxy into a plain
   * ModelElement. Verbatim port of `readElement` in
   * `yorkie-slides-store.ts` (table/chart branches dropped — a board's
   * `YorkieElement` union never includes them).
   */
  private readElement(e: unknown): ModelElement {
    const el = e as {
      id: string;
      type: string;
      frame: unknown;
      data: unknown;
      placeholderRef?: unknown;
    };
    const placeholderRef = yorkieToPlain<PlaceholderRef | undefined>(
      el.placeholderRef,
    );
    if (el.type === 'text') {
      const rawData = (el.data ?? {}) as Record<string, unknown>;
      const blocks = yorkieToPlain<Block[]>(rawData.blocks) ?? [];
      const extras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawData)) {
        if (k === 'blocks') continue;
        extras[k] = yorkieToPlain<unknown>(v);
      }
      return {
        id: el.id,
        type: 'text',
        frame: yorkieToPlain<Frame>(el.frame),
        placeholderRef,
        data: { ...extras, blocks },
      } as ModelElement;
    }
    if (el.type === 'connector') {
      const c = el as unknown as {
        routing: ConnectorElement['routing'];
        start: Endpoint;
        end: Endpoint;
        arrowheads: ConnectorElement['arrowheads'];
        stroke?: ConnectorElement['stroke'];
        elbowBend?: number;
        curveBend?: number;
      };
      return {
        id: el.id,
        type: 'connector',
        frame: yorkieToPlain<Frame>(el.frame),
        routing: c.routing,
        start: yorkieToPlain<Endpoint>(c.start),
        end: yorkieToPlain<Endpoint>(c.end),
        arrowheads:
          yorkieToPlain<ConnectorElement['arrowheads']>(c.arrowheads) ?? {},
        stroke: c.stroke
          ? yorkieToPlain<ConnectorElement['stroke']>(c.stroke)
          : undefined,
        elbowBend: c.elbowBend,
        curveBend: c.curveBend,
      } as ModelElement;
    }
    if (el.type === 'group') {
      const rawData = (el.data ?? {}) as {
        children?: unknown[];
        refSize?: unknown;
      };
      const rawChildren = rawData.children ?? [];
      const children = rawChildren.map((c) => this.readElement(c));
      const refSize = rawData.refSize
        ? yorkieToPlain<{ w: number; h: number }>(rawData.refSize)
        : undefined;
      return {
        id: el.id,
        type: 'group',
        frame: yorkieToPlain<Frame>(el.frame),
        data: refSize ? { children, refSize } : { children },
      } as ModelElement;
    }
    return {
      id: el.id,
      type: el.type,
      frame: yorkieToPlain<Frame>(el.frame),
      placeholderRef,
      data: yorkieToPlain<object>(el.data),
    } as ModelElement;
  }

  // --- batch + undo (verbatim port of YorkieSlidesStore's scaffolding) ---

  private withUpdate(fn: (r: YorkieBoardRoot) => void): void {
    // Sole choke point for local mutations — every mutator routes through
    // here, whether it runs against the ambient `activeRoot` inside a
    // `batch()` or opens its own `doc.update`. Dropping the snapshot in a
    // `finally` (rather than only at the end of `batch()`) is what makes a
    // `read()` BETWEEN two mutations of the same batch observe the first
    // one: Yorkie applies changes to the local root optimistically, so
    // `doc.getRoot()` already reflects them mid-batch. The `finally` also
    // keeps the cache conservative if `fn` throws part-way through.
    try {
      if (this.activeRoot) {
        fn(this.activeRoot);
      } else {
        this.doc.update((r) => fn(r));
      }
    } finally {
      this.invalidateRead();
    }
  }

  private requireBatch(): void {
    if (this.batchDepth === 0) {
      throw new Error('Mutations must be wrapped in batch()');
    }
  }

  batch(fn: () => void): void {
    if (this.batchDepth > 0) {
      this.batchDepth++;
      try {
        fn();
      } finally {
        this.batchDepth--;
      }
      return;
    }
    this.batchDepth++;
    try {
      this.doc.update((r) => {
        this.activeRoot = r;
        try {
          fn();
        } finally {
          this.activeRoot = null;
        }
      });
    } finally {
      this.batchDepth--;
      this.notifyChange();
    }
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.doc.history.undo();
    this.notifyChange();
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.doc.history.redo();
    this.notifyChange();
  }

  canUndo(): boolean {
    return (
      this.doc.history.canUndo() &&
      this.doc.getUndoStackForTest().length > this.undoFloor
    );
  }

  canRedo(): boolean {
    return this.doc.history.canRedo();
  }

  // --- meta ops ---

  setUnit(unit: 'in' | 'cm'): void {
    this.requireBatch();
    if (unit !== 'in' && unit !== 'cm') {
      throw new Error(`[board] invalid unit '${unit}'`);
    }
    this.withUpdate((r) => {
      r.meta.unit = unit;
    });
  }

  pushRecentColor(hex: string): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const meta = r.meta as { recentColors?: ArrayLike<string> };
      const existing: string[] = [];
      const arr = meta.recentColors;
      if (arr) {
        for (let i = 0; i < arr.length; i++) existing.push(String(arr[i]));
      }
      meta.recentColors = pushRecent(existing, hex);
    });
  }

  // --- element ops ---

  addElement(_slideId: string, init: ElementInit, parentGroupId?: string): string {
    this.requireBatch();
    const id = generateId();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      let targetArray: ProxyArray;
      if (parentGroupId !== undefined) {
        const path = yorkieFindElementPath(rootElements, parentGroupId);
        if (!path) {
          throw new Error(
            `[board] addElement(): parent group not found: ${parentGroupId}`,
          );
        }
        const parentEl = path[path.length - 1];
        if (parentEl.type !== 'group') {
          throw new Error(
            `[board] addElement(): element ${parentGroupId} is not a group`,
          );
        }
        targetArray = (parentEl.data as { children: ProxyArray }).children;
      } else {
        targetArray = rootElements;
      }

      if (init.type === 'text') {
        const textData = init.data as { blocks?: Block[]; autofit?: unknown };
        (targetArray as unknown as YorkieElement[]).push({
          id,
          type: 'text',
          frame: { ...init.frame },
          data: {
            blocks: clone(textData.blocks ?? []),
            ...(textData.autofit ? { autofit: textData.autofit } : {}),
          },
        } as YorkieElement);
        return;
      }
      if (init.type === 'connector') {
        const lookup = this.elementsLookup(r);
        const next = { ...clone(init), id } as ConnectorElement;
        next.frame = computeConnectorFrame(next, lookup);
        (targetArray as unknown as YorkieElement[]).push(next as unknown as YorkieElement);
        return;
      }
      (targetArray as unknown as YorkieElement[]).push({ ...clone(init), id } as YorkieElement);
    });
    return id;
  }

  removeElement(_slideId: string, elementId: string): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      this.detachConnectorsTargeting(r, elementId);
      const parentArray = this.resolveYorkieParentArray(rootElements, path);
      const i = parentArray.findIndex((e) => e.id === elementId);
      (parentArray as unknown as { splice(i: number, d: number): void }).splice(i, 1);
      this.pruneEmptyYorkieAncestorGroups(rootElements, path);
    });
  }

  removeElements(_slideId: string, elementIds: string[]): void {
    this.requireBatch();
    const set = new Set(elementIds);
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const paths = new Map<string, ProxyArray>();
      for (const id of set) {
        const path = yorkieFindElementPath(rootElements, id);
        if (path) paths.set(id, path);
      }
      for (const id of set) {
        this.detachConnectorsTargeting(r, id);
      }
      type ParentEntry = { parentArray: ProxyArray; ids: Set<string>; repPath: ProxyArray };
      const byParent = new Map<string, ParentEntry>();
      for (const [id, path] of paths) {
        const parentArray = this.resolveYorkieParentArray(rootElements, path);
        const parentPathKey = path.slice(0, -1).map((e) => e.id).join('/');
        if (!byParent.has(parentPathKey)) {
          byParent.set(parentPathKey, { parentArray, ids: new Set(), repPath: path });
        }
        byParent.get(parentPathKey)!.ids.add(id);
      }
      for (const { parentArray, ids, repPath } of byParent.values()) {
        for (let i = parentArray.length - 1; i >= 0; i--) {
          if (ids.has(parentArray[i].id)) {
            (parentArray as unknown as { splice(i: number, d: number): void }).splice(i, 1);
          }
        }
        this.pruneEmptyYorkieAncestorGroups(rootElements, repPath);
      }
    });
  }

  updateElementFrame(
    _slideId: string,
    elementId: string,
    frame: Partial<Frame>,
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type === 'connector') {
        throw new Error(
          `Element ${elementId} is a connector; update its endpoints instead of its frame`,
        );
      }
      const eAny = e as unknown as { frame: Frame };
      eAny.frame = { ...eAny.frame, ...frame };
      this.recomputeDependentConnectorFrames(r, elementId);
    });
  }

  updateElementData(_slideId: string, elementId: string, patch: object): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type === 'connector') {
        throw new Error(
          `Element ${elementId} is a connector; use updateConnectorEndpoint / updateConnectorArrowheads`,
        );
      }
      const source = { ...(patch as object) } as Record<string, unknown>;
      if (e.type === 'text') {
        delete source.blocks;
        if (Object.keys(source).length === 0) return;
      }
      const data = (e as { data: Record<string, unknown> }).data;
      for (const [k, v] of Object.entries(source)) {
        if (v === undefined) {
          delete data[k];
        } else {
          data[k] = clone(v);
        }
      }
    });
  }

  reorderElement(_slideId: string, elementId: string, toIndex: number): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const parentArray = this.resolveYorkieParentArray(rootElements, path);
      const from = parentArray.findIndex((e) => e.id === elementId);
      const rebuilt = unwrapElement(parentArray[from]) as YorkieElement;
      (parentArray as unknown as { splice(f: number, d: number): void }).splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, parentArray.length));
      (parentArray as unknown as { splice(at: number, del: number, item: YorkieElement): void }).splice(clamped, 0, rebuilt);
    });
  }

  // --- group / ungroup ---

  group(
    _slideId: string,
    elementIds: string[],
  ): { groupId: string; excludedConnectorIds: string[] } {
    this.requireBatch();

    if (elementIds.length < 2) {
      throw new Error(
        `[board] group() requires at least 2 elements, got ${elementIds.length}`,
      );
    }

    let groupId = '';
    let excludedConnectorIds: string[] = [];

    this.withUpdate((r) => {
      const proxyElements = r.elements as unknown as ProxyArray;

      const paths = new Map<string, ProxyArray>();
      for (const id of elementIds) {
        const path = yorkieFindElementPath(proxyElements, id);
        if (!path) throw new Error(`[board] group(): element not found: ${id}`);
        paths.set(id, path);
      }

      const parentKeyOf = (id: string): string => {
        const path = paths.get(id)!;
        if (path.length === 1) return '';
        return path[path.length - 2].id;
      };
      const firstParentKey = parentKeyOf(elementIds[0]);
      for (const id of elementIds.slice(1)) {
        if (parentKeyOf(id) !== firstParentKey) {
          throw new Error(
            `[board] group(): all elements must share the same parent`,
          );
        }
      }

      let parentArray: ProxyArray;
      if (firstParentKey === '') {
        parentArray = proxyElements;
      } else {
        const parentPath = yorkieFindElementPath(proxyElements, firstParentKey);
        if (!parentPath) {
          throw new Error(`[board] group(): parent not found: ${firstParentKey}`);
        }
        const parentEl = parentPath[parentPath.length - 1];
        if (parentEl.type !== 'group') {
          throw new Error(`[board] group(): parent is not a group: ${firstParentKey}`);
        }
        parentArray = (parentEl.data as { children: ProxyArray }).children;
      }

      const candidateSet = new Set(elementIds);
      const allCandidatesInOrder = parentArray.filter((e) => candidateSet.has(e.id));

      for (const el of allCandidatesInOrder) {
        if ((el as { placeholderRef?: unknown }).placeholderRef != null) {
          throw new Error(
            `[board] group(): placeholderRef cannot be grouped (element ${el.id})`,
          );
        }
      }

      const internalCandidates: ProxyArray = [];
      const excluded: string[] = [];

      for (const el of allCandidatesInOrder) {
        if (el.type !== 'connector') {
          internalCandidates.push(el);
          continue;
        }
        const c = el as unknown as { start: Endpoint; end: Endpoint };
        const startInternal =
          c.start.kind === 'free' ||
          candidateSet.has((c.start as { elementId?: string }).elementId ?? '');
        const endInternal =
          c.end.kind === 'free' ||
          candidateSet.has((c.end as { elementId?: string }).elementId ?? '');
        if (startInternal && endInternal) {
          internalCandidates.push(el);
        } else {
          excluded.push(el.id);
          candidateSet.delete(el.id);
        }
      }
      excludedConnectorIds = excluded;

      if (internalCandidates.length < 2) {
        throw new Error(
          `[board] group(): cannot create a group: only ${internalCandidates.length} non-connector element(s) remain after excluding cross-group connectors`,
        );
      }

      const candidatesInOrder = internalCandidates;

      const ancestorTransform = yorkieResolveAncestorTransform(proxyElements, firstParentKey);

      const worldFrames = candidatesInOrder.map((el) => {
        const frame = yorkieToPlain<Frame>((el as unknown as { frame: unknown }).frame)!;
        return applyGroupTransformMatrix(frame, ancestorTransform);
      });

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const wf of worldFrames) {
        const corners = frameCorners(wf);
        for (const [cx, cy] of corners) {
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;
        }
      }
      const MIN_GROUP_DIM = 1;
      const groupWorldFrame: Frame = {
        x: minX, y: minY,
        w: Math.max(maxX - minX, MIN_GROUP_DIM),
        h: Math.max(maxY - minY, MIN_GROUP_DIM),
        rotation: 0,
      };

      const groupLocalFrame = applyInverseMatrix(groupWorldFrame, ancestorTransform);

      const tempGroup: GroupElement = {
        id: '__tmp__',
        type: 'group',
        frame: groupWorldFrame,
        data: { children: [] },
      };
      const groupSelfTransform = groupToTransform(tempGroup);

      const childrenWithLocalFrames = candidatesInOrder.map((el, i) => {
        const plain = unwrapElement(el) as YorkieElement;
        const localFrame = normalizeToGroupLocal(worldFrames[i], tempGroup);
        if ((plain as { type: string }).type === 'connector') {
          const plainConnector = plain as unknown as { start: Endpoint; end: Endpoint; frame: Frame };
          for (const side of ['start', 'end'] as const) {
            const ep = plainConnector[side];
            if (ep.kind === 'free') {
              const worldPt = applyGroupTransformToPoint(ep.x, ep.y, ancestorTransform);
              const local = applyInversePoint(worldPt.x, worldPt.y, groupSelfTransform);
              plainConnector[side] = { kind: 'free', x: local.x, y: local.y };
            }
          }
          return { ...plain, frame: localFrame } as YorkieElement;
        }
        return { ...(plain as YorkieElement), frame: localFrame };
      });

      groupId = generateId();
      const newGroup: YorkieGroupElement = {
        id: groupId,
        type: 'group',
        frame: groupLocalFrame,
        data: {
          children: childrenWithLocalFrames as YorkieGroupElement['data']['children'],
          refSize: { w: groupLocalFrame.w, h: groupLocalFrame.h },
        },
      };

      const candidateIndices = candidatesInOrder.map((el) =>
        parentArray.findIndex((p) => p.id === el.id),
      );
      const frontMostIndex = Math.max(...candidateIndices);

      for (const el of candidatesInOrder) {
        const idx = parentArray.findIndex((p) => p.id === el.id);
        if (idx !== -1) {
          (parentArray as unknown as { splice(i: number, d: number): void }).splice(idx, 1);
        }
      }

      const removedBefore = candidateIndices.filter((i) => i < frontMostIndex).length;
      const insertAt = Math.max(0, frontMostIndex - removedBefore);
      (parentArray as unknown as { splice(at: number, del: number, item: YorkieGroupElement): void })
        .splice(insertAt, 0, newGroup);
    });

    return { groupId, excludedConnectorIds };
  }

  ungroup(_slideId: string, groupId: string): string[] {
    this.requireBatch();

    let childIds: string[] = [];

    this.withUpdate((r) => {
      const proxyElements = r.elements as unknown as ProxyArray;

      const path = yorkieFindElementPath(proxyElements, groupId);
      if (!path) throw new Error(`[board] ungroup(): element not found: ${groupId}`);

      const group = path[path.length - 1];
      if (group.type !== 'group') {
        throw new Error(`[board] ungroup(): element ${groupId} is not a group`);
      }

      let parentArray: ProxyArray;
      if (path.length === 1) {
        parentArray = proxyElements;
      } else {
        const parentEl = path[path.length - 2];
        parentArray = (parentEl.data as { children: ProxyArray }).children;
      }

      const groupIndex = parentArray.findIndex((e) => e.id === groupId);

      this.bakeProxyGroupTree(group as unknown as YorkieElement);

      const plainGroup = unwrapElement(group) as unknown as GroupElement;

      const groupTx = groupToTransform(plainGroup);
      const bakedChildren: YorkieElement[] = plainGroup.data.children.map((child) => {
        const next = {
          ...clone(child),
          frame: applyGroupTransform(child.frame, plainGroup),
        } as YorkieElement;
        if (next.type === 'connector') {
          const c = next as unknown as { start: { kind: string; x: number; y: number }; end: { kind: string; x: number; y: number } };
          for (const side of ['start', 'end'] as const) {
            const ep = c[side];
            if (ep.kind === 'free') {
              const p = applyGroupTransformToPoint(ep.x, ep.y, groupTx);
              c[side] = { kind: 'free', x: p.x, y: p.y };
            }
          }
        }
        return next;
      });

      childIds = bakedChildren.map((c) => (c as { id: string }).id);

      (parentArray as unknown as {
        splice(i: number, d: number, ...items: YorkieElement[]): void
      }).splice(groupIndex, 1, ...bakedChildren);
    });

    return childIds;
  }

  refitGroup(_slideId: string, groupId: string): void {
    this.requireBatch();

    this.withUpdate((r) => {
      const proxyElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(proxyElements, groupId);
      if (!path) return;

      const group = path[path.length - 1];
      if (group.type !== 'group') return;

      const plainGroup = unwrapElement(group) as unknown as GroupElement;
      if (plainGroup.data.children.length === 0) return;

      const { worldFrame: newFrame, localShift, newRefSize } =
        worldTightFrame(plainGroup);

      const EPS = 0.5;
      const close = (a: number, b: number) => Math.abs(a - b) < EPS;
      if (
        close(localShift.x, 0) &&
        close(localShift.y, 0) &&
        close(newRefSize.w, plainGroup.data.refSize?.w ?? plainGroup.frame.w) &&
        close(newRefSize.h, plainGroup.data.refSize?.h ?? plainGroup.frame.h)
      ) {
        return;
      }

      const gAny = group as unknown as {
        frame: Frame;
        data: { refSize: { w: number; h: number }; children: ProxyArray };
      };
      gAny.frame = { ...newFrame };
      gAny.data.refSize = { ...newRefSize };

      gAny.data.children.forEach((ch) => {
        const chAny = ch as unknown as {
          type: string;
          frame: Frame;
          start?: Endpoint;
          end?: Endpoint;
        };
        chAny.frame = {
          ...chAny.frame,
          x: chAny.frame.x - localShift.x,
          y: chAny.frame.y - localShift.y,
        };
        if (chAny.type === 'connector') {
          for (const side of ['start', 'end'] as const) {
            const ep = chAny[side];
            if (ep && ep.kind === 'free') {
              (chAny as unknown as Record<'start' | 'end', Endpoint>)[side] = {
                kind: 'free',
                x: ep.x - localShift.x,
                y: ep.y - localShift.y,
              };
            }
          }
        }
      });
    });
  }

  /**
   * Bake a proxy group's render-scale into its children and recurse into
   * any child group. Verbatim port of `bakeProxyGroupTree` in
   * `yorkie-slides-store.ts`.
   */
  private bakeProxyGroupTree(group: YorkieElement): void {
    const plainGroup = unwrapElement(group) as unknown as GroupElement;
    const gAny = group as unknown as {
      frame: Frame;
      data: { refSize: { w: number; h: number }; children: ProxyArray };
    };

    if (plainGroup.data.children.length === 0) {
      gAny.data.refSize = { w: plainGroup.frame.w, h: plainGroup.frame.h };
      return;
    }

    const pRefW = plainGroup.data.refSize?.w ?? plainGroup.frame.w;
    const pRefH = plainGroup.data.refSize?.h ?? plainGroup.frame.h;
    const psx = pRefW > 0 ? plainGroup.frame.w / pRefW : 1;
    const psy = pRefH > 0 ? plainGroup.frame.h / pRefH : 1;
    if (psx !== 1 || psy !== 1) {
      gAny.data.children.forEach((ch, i) => {
        const plainCh = plainGroup.data.children[i];
        if (plainCh.type === 'group' && !plainCh.data.refSize) {
          (ch as unknown as { data: { refSize: { w: number; h: number } } }).data.refSize = {
            w: plainCh.frame.w,
            h: plainCh.frame.h,
          };
        }
      });
    }

    const { children: bakedChildren, refSize } = bakeGroupScale(plainGroup);
    if (bakedChildren !== plainGroup.data.children) {
      gAny.data.children.forEach((ch, i) => {
        const next = bakedChildren[i];
        const chAny = ch as unknown as {
          type: string;
          frame: Frame;
          start?: Endpoint;
          end?: Endpoint;
        };
        chAny.frame = { ...next.frame };
        if (next.type === 'connector') {
          (chAny as unknown as Record<'start' | 'end', Endpoint>).start = next.start;
          (chAny as unknown as Record<'start' | 'end', Endpoint>).end = next.end;
        }
      });
    }
    gAny.data.refSize = refSize;

    gAny.data.children.forEach((ch) => {
      if ((ch as unknown as { type: string }).type === 'group') {
        this.bakeProxyGroupTree(ch as unknown as YorkieElement);
      }
    });
  }

  bakeGroupResize(_slideId: string, groupId: string): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const proxyElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(proxyElements, groupId);
      if (!path) return;

      const group = path[path.length - 1];
      if (group.type !== 'group') return;

      this.bakeProxyGroupTree(group as unknown as YorkieElement);
    });
  }

  // --- connector ops ---

  updateConnectorEndpoint(
    _slideId: string,
    elementId: string,
    side: 'start' | 'end',
    endpoint: Endpoint,
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as { start: Endpoint; end: Endpoint; frame: Frame };
      if (side === 'start') c.start = clone(endpoint);
      else c.end = clone(endpoint);
      const plain = unwrapElement(e) as unknown as ConnectorElement;
      c.frame = computeConnectorFrame(plain, this.elementsLookup(r));
    });
  }

  updateConnectorArrowheads(
    _slideId: string,
    elementId: string,
    heads: { start?: ArrowheadStyle | null; end?: ArrowheadStyle | null },
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as {
        arrowheads: { start?: ArrowheadStyle; end?: ArrowheadStyle };
      };
      const prev =
        yorkieToPlain<{ start?: ArrowheadStyle; end?: ArrowheadStyle }>(
          c.arrowheads,
        ) ?? {};
      const next: { start?: ArrowheadStyle; end?: ArrowheadStyle } = { ...prev };
      for (const side of ['start', 'end'] as const) {
        if (!(side in heads)) continue;
        const value = heads[side];
        if (value === null) {
          delete next[side];
        } else if (value !== undefined) {
          next[side] = clone(value);
        }
      }
      c.arrowheads = next;
    });
  }

  updateConnectorStroke(
    _slideId: string,
    elementId: string,
    stroke: Stroke | undefined,
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as { stroke?: Stroke };
      if (stroke === undefined) {
        delete c.stroke;
      } else {
        c.stroke = clone(stroke);
      }
    });
  }

  updateConnectorRouting(
    _slideId: string,
    elementId: string,
    routing: ConnectorRouting,
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as {
        routing: ConnectorRouting;
        elbowBend?: number;
        curveBend?: number;
        frame: Frame;
      };
      if (c.routing === routing) return;
      c.routing = routing;
      if (routing !== 'elbow') delete c.elbowBend;
      if (routing !== 'curved') delete c.curveBend;
      const plain = unwrapElement(e) as unknown as ConnectorElement;
      c.frame = computeConnectorFrame(plain, this.elementsLookup(r));
    });
  }

  updateConnectorElbowBend(
    _slideId: string,
    elementId: string,
    bend: number | undefined,
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as { routing: ConnectorRouting; elbowBend?: number; frame: Frame };
      if (c.routing !== 'elbow') return;
      if (bend === undefined || !Number.isFinite(bend)) {
        delete c.elbowBend;
      } else {
        c.elbowBend = Math.round(bend * 100) / 100;
      }
      const plain = unwrapElement(e) as unknown as ConnectorElement;
      c.frame = computeConnectorFrame(plain, this.elementsLookup(r));
    });
  }

  updateConnectorCurveBend(
    _slideId: string,
    elementId: string,
    bend: number | undefined,
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as { routing: ConnectorRouting; curveBend?: number; frame: Frame };
      if (c.routing !== 'curved') return;
      if (bend === undefined || !Number.isFinite(bend)) {
        delete c.curveBend;
      } else {
        const rounded = Math.round(bend * 100) / 100;
        c.curveBend = Math.min(CURVE_BEND_MAX, Math.max(CURVE_BEND_MIN, rounded));
      }
      const plain = unwrapElement(e) as unknown as ConnectorElement;
      c.frame = computeConnectorFrame(plain, this.elementsLookup(r));
    });
  }

  // --- guides: unsupported ---
  //
  // A board has no ruler UI (`initializeEditor` in `board-view.tsx`
  // passes neither `hRulerCanvas`/`vRulerCanvas`/`rulerCorner`), and the
  // slides editor only ever calls `addGuide`/`moveGuide`/`removeGuide`
  // from its ruler drag-out interaction (`guideDragHost()` in
  // `editor.ts`) — so these are unreachable in normal board use. Follow
  // `notSupported` like every other slide-scoped op this store doesn't
  // implement, rather than persisting orphan `root.guides` CRDT state
  // that `boardToSlidesDocument` always drops (`guides: []`) and no UI
  // ever reads.

  addGuide(): string {
    return notSupported('addGuide');
  }

  moveGuide(): void {
    notSupported('moveGuide');
  }

  removeGuide(): void {
    notSupported('removeGuide');
  }

  // --- text bridges ---

  withTextElement(
    _slideId: string,
    elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'text') {
        throw new Error(`Element ${elementId} is not a text element`);
      }
      const blocks = yorkieToPlain<Block[]>((e.data as { blocks?: unknown }).blocks) ?? [];
      const next = fn(blocks);
      const eAny = e as { data: Record<string, unknown> };
      eAny.data = {
        ...eAny.data,
        blocks: clone(next ?? blocks),
      };
    });
  }

  withShapeText(
    _slideId: string,
    elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    this.withUpdate((r) => {
      const rootElements = r.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(rootElements, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'shape') {
        throw new Error(`Element ${elementId} is not a shape element`);
      }
      const eAny = e as { data: Record<string, unknown> };
      const priorTextPlain = yorkieToPlain<{
        blocks?: Block[];
        autofit?: unknown;
        verticalAnchor?: unknown;
      }>(eAny.data.text);
      const hadTextField = priorTextPlain !== undefined;
      const priorText = priorTextPlain ?? {};
      const priorBlocks = priorText.blocks ?? [];
      const returned = fn(priorBlocks);
      const nextBlocks = returned !== undefined ? clone(returned) : priorBlocks;
      if (isBlocksEmpty(nextBlocks) && !hadTextField) return;
      const existingText = eAny.data.text as
        | { blocks?: unknown; autofit?: unknown; verticalAnchor?: unknown }
        | undefined;
      if (existingText !== undefined) {
        existingText.blocks = clone(nextBlocks);
      } else {
        eAny.data.text = clone({ ...priorText, blocks: nextBlocks });
      }
    });
  }

  // --- internal: element-tree helpers (verbatim ports, operating on
  // `root.elements` instead of a slide's `elements`) ---

  /**
   * Build an id → world-frame element lookup for connector endpoint
   * resolution. Must be RECURSIVE (via `buildElementWorldLookup`, which
   * descends into `group.data.children` composing group transforms) —
   * a top-level-only lookup can't find a connector's target once that
   * element becomes a group child, so `resolveEndpoint` would fall back
   * to `{x:0,y:0}` and the connector would jump to the origin on any
   * recompute (`updateConnectorEndpoint`/`Routing`/`Bend`, detach).
   * Mirrors the same fix in `YorkieSlidesStore.setSlideHeight`.
   */
  private elementsLookup(r: YorkieBoardRoot): ReadonlyMap<string, ModelElement> {
    const plainEls = r.elements.map(
      (e) => unwrapElement(e) as unknown as ModelElement,
    );
    return buildElementWorldLookup(plainEls);
  }

  private detachConnectorsTargeting(r: YorkieBoardRoot, targetId: string): void {
    const lookup = this.elementsLookup(r);
    walkYorkieElements(r.elements as unknown as ProxyArray, (el) => {
      if (el.type !== 'connector') return;
      const c = el as unknown as { start: Endpoint; end: Endpoint; frame: Frame };
      let mutated = false;
      for (const side of ['start', 'end'] as const) {
        const ep = c[side];
        if (ep.kind === 'attached' && ep.elementId === targetId) {
          const w = resolveEndpoint(ep, lookup);
          c[side] = { kind: 'free', x: w.x, y: w.y };
          mutated = true;
        }
      }
      if (mutated) {
        const plain = unwrapElement(el) as unknown as ConnectorElement;
        c.frame = computeConnectorFrame(plain, lookup);
      }
    });
  }

  private recomputeDependentConnectorFrames(r: YorkieBoardRoot, sourceId: string): void {
    const lookup = this.elementsLookup(r);
    walkYorkieElements(r.elements as unknown as ProxyArray, (el) => {
      if (el.type !== 'connector') return;
      const c = el as unknown as { start: Endpoint; end: Endpoint; frame: Frame };
      const dependsOnUs =
        (c.start.kind === 'attached' && c.start.elementId === sourceId) ||
        (c.end.kind === 'attached' && c.end.elementId === sourceId);
      if (dependsOnUs) {
        const plain = unwrapElement(el) as unknown as ConnectorElement;
        c.frame = computeConnectorFrame(plain, lookup);
      }
    });
  }

  private resolveYorkieParentArray(rootElements: ProxyArray, path: ProxyArray): ProxyArray {
    if (path.length === 1) return rootElements;
    const parent = path[path.length - 2];
    return (parent.data as { children: ProxyArray }).children;
  }

  private pruneEmptyYorkieAncestorGroups(rootElements: ProxyArray, path: ProxyArray): void {
    for (let depth = path.length - 2; depth >= 0; depth--) {
      const ancestor = path[depth];
      if (ancestor.type !== 'group') break;
      const children = (ancestor.data as { children: ProxyArray }).children;
      if (children.length > 0) break;
      const ancestorParentArray: ProxyArray =
        depth === 0
          ? rootElements
          : (path[depth - 1].data as { children: ProxyArray }).children;
      const idx = ancestorParentArray.findIndex((e) => e.id === ancestor.id);
      if (idx !== -1) {
        (ancestorParentArray as unknown as { splice(i: number, d: number): void }).splice(idx, 1);
      }
    }
  }

  // --- unsupported: slide-level ---
  //
  // Every stub below intentionally declares NO parameters: none of them
  // read their arguments (the method always throws), and TypeScript
  // allows an implementation with fewer parameters than the interface
  // signature — the extra call-site arguments are simply never bound.
  // This also sidesteps `@typescript-eslint/no-unused-vars` (this repo's
  // eslint config has no `argsIgnorePattern`, so an `_`-prefixed unused
  // parameter would still be flagged) without an eslint-disable comment
  // per stub.

  addSlide(): string {
    return notSupported('addSlide');
  }
  duplicateSlide(): string {
    return notSupported('duplicateSlide');
  }
  removeSlide(): void {
    notSupported('removeSlide');
  }
  removeSlides(): void {
    notSupported('removeSlides');
  }
  moveSlide(): void {
    notSupported('moveSlide');
  }
  moveSlides(): void {
    notSupported('moveSlides');
  }
  updateSlideBackground(): void {
    notSupported('updateSlideBackground');
  }
  applyLayout(): void {
    notSupported('applyLayout');
  }
  setSlideTransition(): void {
    notSupported('setSlideTransition');
  }
  setSlideHeight(): void {
    notSupported('setSlideHeight');
  }

  // --- unsupported: animation-level ---

  addAnimation(): string {
    return notSupported('addAnimation');
  }
  updateAnimation(): void {
    notSupported('updateAnimation');
  }
  removeAnimation(): void {
    notSupported('removeAnimation');
  }
  reorderAnimation(): void {
    notSupported('reorderAnimation');
  }

  // --- unsupported: theme/master/layout-level ---

  addTheme(): void {
    notSupported('addTheme');
  }
  applyTheme(): void {
    notSupported('applyTheme');
  }
  updateTheme(): void {
    notSupported('updateTheme');
  }
  updateMaster(): void {
    notSupported('updateMaster');
  }
  updateLayout(): void {
    notSupported('updateLayout');
  }
  updateLayoutPlaceholderFrame(): void {
    notSupported('updateLayoutPlaceholderFrame');
  }

  // --- unsupported: table-level ---

  withTableCellBody(): void {
    notSupported('withTableCellBody');
  }
  insertTableRow(): void {
    notSupported('insertTableRow');
  }
  insertTableColumn(): void {
    notSupported('insertTableColumn');
  }
  deleteTableRow(): void {
    notSupported('deleteTableRow');
  }
  deleteTableColumn(): void {
    notSupported('deleteTableColumn');
  }
  mergeTableCells(): void {
    notSupported('mergeTableCells');
  }
  unmergeTableCells(): void {
    notSupported('unmergeTableCells');
  }
  updateTableCellStyle(): void {
    notSupported('updateTableCellStyle');
  }
  updateTableColumnWidths(): void {
    notSupported('updateTableColumnWidths');
  }
  updateTableRowHeights(): void {
    notSupported('updateTableRowHeights');
  }

  // --- unsupported: notes (per-slide speaker notes; a board has no slides) ---

  withNotes(): void {
    notSupported('withNotes');
  }
}
