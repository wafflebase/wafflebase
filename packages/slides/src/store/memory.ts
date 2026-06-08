import type { SlidesStore } from './store';
import type {
  Background,
  Guide,
  GuideAxis,
  Slide,
  SlidesDocument,
} from '../model/presentation';
import type { Block } from '@wafflebase/docs';
import type {
  ArrowheadStyle,
  ConnectorRouting,
  Endpoint,
} from '../model/connector';
import type { Stroke } from '../model/element';
import type {
  Element,
  ElementInit,
  Frame,
  GroupElement,
  TableCell,
} from '../model/element';
import { generateId, isBlocksEmpty } from '../model/element';
import { BUILT_IN_LAYOUTS, applyLayoutToSlide, getLayout, slotRefsForLayout } from '../model/layout';
import { DEFAULT_BACKGROUND } from '../model/presentation';
import { DEFAULT_MASTER } from '../model/master';
import { migrateDocument } from '../model/migrate';
import { seedPlaceholderBlocks } from '../model/placeholder-blocks';
import type { Theme } from '../model/theme';
import { defaultLight } from '../themes/default-light';
import { clone } from '../model/clone';
import {
  computeConnectorFrame,
  resolveEndpoint,
} from '../view/canvas/connector-frame';
import {
  IDENTITY_GROUP_TRANSFORM,
  applyGroupTransform,
  applyInverseMatrix,
  applyInversePoint,
  buildElementWorldLookup,
  composeAncestorTransform,
  findElementPath,
  flattenElements,
  groupToTransform,
  normalizeToGroupLocal,
  worldTightFrame,
} from '../model/group';
import type { GroupTransform } from '../model/group';
import {
  applyGroupTransform as applyMatrix,
  applyGroupTransformToPoint,
} from '../import/pptx/group';

/**
 * Throw early when a caller passes `NaN` / `Infinity` into a guide
 * mutator. The renderer's `position * scale` math and the snap
 * engine's `Math.abs(diff)` both propagate `NaN` silently, so
 * letting a bad value reach the store would surface as a hard-to-
 * diagnose downstream artifact.
 */
function assertFinitePosition(op: string, position: number): void {
  if (!Number.isFinite(position)) {
    throw new Error(`${op}: position must be a finite number, got ${position}`);
  }
}

function emptyDocument(): SlidesDocument {
  return {
    meta: {
      title: 'Untitled presentation',
      themeId: 'default-light',
      masterId: 'default',
    },
    themes: [clone(defaultLight)],
    masters: [clone(DEFAULT_MASTER)],
    layouts: clone(BUILT_IN_LAYOUTS),
    slides: [],
    guides: [],
  };
}

export class MemSlidesStore implements SlidesStore {
  private doc: SlidesDocument;
  private undoStack: SlidesDocument[] = [];
  private redoStack: SlidesDocument[] = [];
  private batchDepth = 0;

  constructor(doc?: SlidesDocument) {
    // Migrate at construction so mutators like `addTheme` / `applyTheme`
    // that access `this.doc.themes` directly don't throw `TypeError` on
    // legacy-shaped input before `read()` ever runs.
    this.doc = doc ? migrateDocument(clone(doc)) : emptyDocument();
  }

  read(): SlidesDocument {
    // Also migrate on read. After construction the doc is in v0.5 shape,
    // but mutators that accept untyped/legacy input (e.g. test paths
    // that cast through `unknown`, or future external callers) can
    // re-introduce legacy field shapes mid-session. Keeping `read()`
    // pass through migrate keeps Mem ≡ Yorkie equivalence — Yorkie's
    // `read()` always migrates because remote peers can send arbitrary
    // shapes. `migrateDocument` is idempotent, so the second pass is
    // near no-op for already-migrated docs.
    return migrateDocument(clone(this.doc));
  }

  // --- slide ops ---

  addSlide(layoutId: string, atIndex?: number): string {
    this.requireBatch();
    const layout = getLayout(layoutId);
    const id = generateId();
    const refs = slotRefsForLayout(layout);
    const master =
      this.doc.masters.find((m) => m.id === this.doc.meta.masterId)
      ?? this.doc.masters[0];
    const theme =
      this.doc.themes.find((t) => t.id === this.doc.meta.themeId)
      ?? this.doc.themes[0];
    const slide: Slide = {
      id,
      layoutId: layout.id,
      background: clone(DEFAULT_BACKGROUND),
      elements: layout.placeholders.map((p, i) => {
        const ref = refs[i];
        const cloned = clone(p);
        // Seed typed-text styling from the master's PlaceholderStyle so
        // user keystrokes inherit fontSize / fontFamily / color from
        // the very first character (matches the ghost-text rendering).
        if (cloned.type === 'text' && master && theme) {
          const placeholderStyle =
            master.placeholderStyles[ref.type]
            ?? master.placeholderStyles.body;
          if (placeholderStyle) {
            // Preserve spread of the cloned spec's `data` (notably
            // `autofit`) while replacing only `blocks` with master-styled
            // seeds — a bare `data = { blocks }` would drop the
            // placeholder's seeded autofit mode.
            cloned.data = {
              ...cloned.data,
              blocks: seedPlaceholderBlocks(placeholderStyle, theme),
            };
          }
        }
        return {
          ...cloned,
          id: generateId(),
          placeholderRef: ref,
        } as Element;
      }),
      notes: [],
    };
    const insertAt = atIndex === undefined
      ? this.doc.slides.length
      : Math.max(0, Math.min(atIndex, this.doc.slides.length));
    this.doc.slides.splice(insertAt, 0, slide);
    return id;
  }

  duplicateSlide(slideId: string): string {
    this.requireBatch();
    const index = this.requireSlideIndex(slideId);
    const source = this.doc.slides[index];
    const copy: Slide = clone(source);
    copy.id = generateId();
    // Regenerate element ids and build oldId → newId map so attached
    // endpoints on connectors can be rewritten to reference the new ids.
    // Without this, every duplicated slide with an attached connector
    // would silently leave the connector pointing at the source slide's
    // element id — which still resolves on the source but resolves to
    // (0,0) on the copy (resolveEndpoint's missing-target fallback).
    const idMap = new Map<string, string>();
    copy.elements = copy.elements.map((e) => {
      const newId = generateId();
      idMap.set(e.id, newId);
      return { ...e, id: newId };
    });
    // Rewrite connector endpoints; recompute their cached frame off the
    // new id space.
    const lookup = new Map(copy.elements.map((e) => [e.id, e] as const));
    for (const e of copy.elements) {
      if (e.type !== 'connector') continue;
      for (const side of ['start', 'end'] as const) {
        const ep = e[side];
        if (ep.kind === 'attached') {
          const mapped = idMap.get(ep.elementId);
          if (mapped) e[side] = { ...ep, elementId: mapped };
        }
      }
      e.frame = computeConnectorFrame(e, lookup);
    }
    this.doc.slides.splice(index + 1, 0, copy);
    return copy.id;
  }

  removeSlide(slideId: string): void {
    this.requireBatch();
    const index = this.requireSlideIndex(slideId);
    this.doc.slides.splice(index, 1);
  }

  removeSlides(slideIds: string[]): void {
    this.requireBatch();
    const set = new Set(slideIds);
    this.doc.slides = this.doc.slides.filter((s) => !set.has(s.id));
  }

  moveSlide(slideId: string, toIndex: number): void {
    this.requireBatch();
    const from = this.requireSlideIndex(slideId);
    const [slide] = this.doc.slides.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, this.doc.slides.length));
    this.doc.slides.splice(clamped, 0, slide);
  }

  moveSlides(slideIds: string[], toIndex: number): void {
    this.requireBatch();
    // Pull them out preserving relative order, then re-insert as a block.
    const set = new Set(slideIds);
    const moving = this.doc.slides.filter((s) => set.has(s.id));
    this.doc.slides = this.doc.slides.filter((s) => !set.has(s.id));
    const clamped = Math.max(0, Math.min(toIndex, this.doc.slides.length));
    this.doc.slides.splice(clamped, 0, ...moving);
  }

  updateSlideBackground(slideId: string, bg: Background): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    slide.background = clone(bg);
  }

  addTheme(theme: Theme): void {
    this.requireBatch();
    if (this.doc.themes.find((t) => t.id === theme.id)) return; // idempotent
    this.doc.themes.push(clone(theme));
  }

  applyTheme(themeId: string): void {
    this.requireBatch();
    if (!this.doc.themes.find((t) => t.id === themeId)) {
      throw new Error(`[slides] theme '${themeId}' not in document`);
    }
    this.doc.meta.themeId = themeId;
  }

  setUnit(unit: 'in' | 'cm'): void {
    this.requireBatch();
    if (unit !== 'in' && unit !== 'cm') {
      throw new Error(`[slides] invalid unit '${unit}'`);
    }
    this.doc.meta.unit = unit;
  }

  applyLayout(slideId: string, layoutId: string): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const master =
      this.doc.masters.find((m) => m.id === this.doc.meta.masterId)
      ?? this.doc.masters[0];
    const theme =
      this.doc.themes.find((t) => t.id === this.doc.meta.themeId)
      ?? this.doc.themes[0];
    applyLayoutToSlide(
      slide,
      getLayout(layoutId),
      master && theme ? { master, theme } : undefined,
    );
  }

  // --- element ops ---

  addElement(slideId: string, init: ElementInit, parentGroupId?: string): string {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const id = generateId();
    const element = { ...clone(init), id } as Element;

    if (parentGroupId !== undefined) {
      // Append to the named group's children instead of the slide root.
      const path = findElementPath(slide.elements, parentGroupId);
      if (!path) {
        throw new Error(`[slides] addElement(): parent group not found: ${parentGroupId}`);
      }
      const parent = path[path.length - 1];
      if (parent.type !== 'group') {
        throw new Error(
          `[slides] addElement(): element ${parentGroupId} is not a group`,
        );
      }
      parent.data.children.push(element);
    } else {
      slide.elements.push(element);
    }

    // Connectors carry a derived `frame` cache; the insert call path uses
    // `buildConnectorInit` which pre-fills it correctly, but any future
    // paste/import path could persist a degenerate `{0,0,0,0}` frame and
    // silently break the selection bbox. Recompute defensively here so
    // the cache is always derived from the endpoints — for both slide-root
    // and group-nested connectors.
    if (element.type === 'connector') {
      // Use the full element tree so endpoints targeting group-nested
      // elements resolve correctly.
      const lookup = this.elementsLookup(slideId);
      element.frame = computeConnectorFrame(element, lookup);
    }
    return id;
  }

  removeElement(slideId: string, elementId: string): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const path = findElementPath(slide.elements, elementId);
    if (!path) throw new Error(`Element not found: ${elementId}`);
    // Cascade sweep — any connector still attached to the element being
    // removed must convert that endpoint to a `free` endpoint pinned at
    // the endpoint's *current* world position, so the connector survives
    // source deletion without snapping to the origin. (Q4 c1 policy.)
    // We compute the world position *before* removing the source from the
    // lookup so attached siteWorldPos still resolves.
    this.detachConnectorsTargeting(slide, elementId);
    const parentArray = this.resolveParentArray(slide, path);
    const i = parentArray.findIndex((e) => e.id === elementId);
    parentArray.splice(i, 1);
    this.pruneEmptyAncestorGroups(slide, path);
  }

  removeElements(slideId: string, elementIds: string[]): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const set = new Set(elementIds);
    // Collect paths before any removal so they all resolve correctly.
    const paths = new Map<string, Element[]>();
    for (const id of set) {
      const path = findElementPath(slide.elements, id);
      if (path) paths.set(id, path);
    }
    // Cascade sweep — convert any endpoint attached to one of the
    // about-to-be-removed elements into a free endpoint at its last
    // world position before any source is dropped.
    for (const id of set) {
      this.detachConnectorsTargeting(slide, id);
    }
    // Remove from deepest leaves first to avoid stale path references.
    // Group by parent array and splice all at once per parent.
    this.removeElementsByPaths(slide, [...paths.values()]);
  }

  /**
   * Remove elements identified by their full paths. Groups elements by
   * parent array and splices in one pass per parent, then prunes any
   * empty ancestor groups that result.
   */
  private removeElementsByPaths(slide: Slide, paths: Element[][]): void {
    // Build a map from parent-path key to { parentArray, idsToRemove, representativePath }.
    // Keyed by the joined ancestor ids so all elements sharing the same parent are batched.
    type ParentEntry = { parentArray: Element[]; ids: Set<string>; representativePath: Element[] };
    const byParent = new Map<string, ParentEntry>();
    for (const path of paths) {
      const id = path[path.length - 1].id;
      const parentArray = this.resolveParentArray(slide, path);
      const parentPathKey = path.slice(0, -1).map((e) => e.id).join('/');
      if (!byParent.has(parentPathKey)) {
        byParent.set(parentPathKey, { parentArray, ids: new Set(), representativePath: path });
      }
      const entry = byParent.get(parentPathKey);
      if (!entry) throw new Error(`[slides] removeElementsByPaths: missing entry for key '${parentPathKey}'`);
      entry.ids.add(id);
    }
    // Splice each parent array once (reverse order to keep indices stable).
    for (const { parentArray, ids, representativePath } of byParent.values()) {
      for (let i = parentArray.length - 1; i >= 0; i--) {
        if (ids.has(parentArray[i].id)) parentArray.splice(i, 1);
      }
      // pruneEmptyAncestorGroups walks from path.length-2 upward.
      // We pass the representative path so it starts at the right parent depth.
      this.pruneEmptyAncestorGroups(slide, representativePath);
    }
  }

  updateElementFrame(
    slideId: string, elementId: string, frame: Partial<Frame>,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type === 'connector') {
      // Connector frame is derived from endpoint positions — patching it
      // directly would leave the cached bbox out of sync with the
      // endpoints. Callers must mutate endpoints via
      // `updateConnectorEndpoint`, which recomputes the frame for them.
      throw new Error(
        `Element ${elementId} is a connector; update its endpoints instead of its frame`,
      );
    }
    const oldW = e.frame.w;
    const oldH = e.frame.h;
    e.frame = { ...e.frame, ...frame };
    // Tables paint cells from `data.columnWidths` and `rows[].height`
    // (authoritative per design); a frame resize that bypassed these
    // would leave the painted footprint disconnected from the selection
    // bbox / hit-test region. Proportionally scale so a generic
    // `updateElementFrame` keeps the model coherent without making
    // every resize call site table-aware.
    if (e.type === 'table') {
      if (e.frame.w !== oldW && oldW > 0) {
        const sx = e.frame.w / oldW;
        e.data.columnWidths = e.data.columnWidths.map((w) => w * sx);
      }
      if (e.frame.h !== oldH && oldH > 0) {
        const sy = e.frame.h / oldH;
        e.data.rows = e.data.rows.map((r) => ({ ...r, height: r.height * sy }));
      }
    }
    // Recompute cached frames of connectors whose endpoints attach to
    // this element. The renderer reads endpoints live, so the visual
    // line already follows the source move — but selection bbox /
    // hit-testing uses the cached `frame`, which must stay fresh.
    // This is derived state; the snapshot-based undo already restores
    // the prior frame from the pre-batch snapshot.
    // Walk the full element tree so connectors nested inside groups are
    // also refreshed when their targets move.
    const lookup = this.elementsLookup(slideId);
    for (const el of flattenElements(slide.elements)) {
      if (el.type !== 'connector') continue;
      const dependsOnUs =
        (el.start.kind === 'attached' && el.start.elementId === elementId) ||
        (el.end.kind   === 'attached' && el.end.elementId   === elementId);
      if (dependsOnUs) {
        el.frame = computeConnectorFrame(el, lookup);
      }
    }
  }

  updateElementData(
    slideId: string, elementId: string, patch: object,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type === 'connector') {
      // Connectors have no `data` sub-object; use `updateConnectorEndpoint`
      // or `updateConnectorArrowheads` instead.
      throw new Error(
        `Element ${elementId} is a connector; use updateConnectorEndpoint / updateConnectorArrowheads`,
      );
    }
    // discriminated union — patch only the data sub-object.
    // Apply the patch key-by-key so that explicit `undefined` values remove
    // the key (JSON.stringify strips undefined, so we cannot use clone here).
    const merged: Record<string, unknown> = { ...(e.data as object) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) {
        delete merged[k];
      } else {
        merged[k] = clone(v);
      }
    }
    e.data = merged as typeof e.data;
  }

  updateConnectorEndpoint(
    slideId: string,
    elementId: string,
    side: 'start' | 'end',
    endpoint: Endpoint,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    e[side] = clone(endpoint);
    e.frame = computeConnectorFrame(e, this.elementsLookup(slideId));
  }

  updateConnectorArrowheads(
    slideId: string,
    elementId: string,
    heads: {
      start?: ArrowheadStyle | null;
      end?:   ArrowheadStyle | null;
    },
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    // Build a fresh arrowheads object — never mutate the existing one
    // in place, since other places may hold a snapshot reference to it.
    const next: { start?: ArrowheadStyle; end?: ArrowheadStyle } = {
      ...e.arrowheads,
    };
    for (const side of ['start', 'end'] as const) {
      if (!(side in heads)) continue; // `undefined` means "don't touch"
      const value = heads[side];
      if (value === null) {
        delete next[side];
      } else if (value !== undefined) {
        next[side] = clone(value);
      }
    }
    e.arrowheads = next;
  }

  updateConnectorStroke(
    slideId: string, elementId: string, stroke: Stroke | undefined,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    if (stroke === undefined) {
      delete e.stroke;
    } else {
      e.stroke = clone(stroke);
    }
  }

  updateConnectorRouting(
    slideId: string, elementId: string, routing: ConnectorRouting,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    if (e.routing === routing) return;
    e.routing = routing;
    // A persisted bend is only meaningful for elbow routing; drop it on
    // the way out so a future return to elbow starts from the default.
    if (routing !== 'elbow') delete e.elbowBend;
    e.frame = computeConnectorFrame(e, this.elementsLookup(slideId));
  }

  updateConnectorElbowBend(
    slideId: string, elementId: string, bend: number | undefined,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    if (bend === undefined) {
      delete e.elbowBend;
    } else {
      // Round to 0.01 so the CRDT payload stays tidy under drag updates.
      e.elbowBend = Math.round(bend * 100) / 100;
    }
    e.frame = computeConnectorFrame(e, this.elementsLookup(slideId));
  }

  reorderElement(
    slideId: string, elementId: string, toIndex: number,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const path = findElementPath(slide.elements, elementId);
    if (!path) throw new Error(`Element not found: ${elementId}`);
    // toIndex is relative to the immediate parent array.
    const parentArray = this.resolveParentArray(slide, path);
    const from = parentArray.findIndex((e) => e.id === elementId);
    const [el] = parentArray.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, parentArray.length));
    parentArray.splice(clamped, 0, el);
  }

  // --- group / ungroup ---

  group(
    slideId: string,
    elementIds: string[],
  ): { groupId: string; excludedConnectorIds: string[] } {
    this.requireBatch();

    // Invariant 1: need at least two elements.
    if (elementIds.length < 2) {
      throw new Error(
        `[slides] group() requires at least 2 elements, got ${elementIds.length}`,
      );
    }

    const slide = this.requireSlide(slideId);

    // Invariant 2: all ids must exist somewhere on this slide.
    const paths = new Map<string, Element[]>();
    for (const id of elementIds) {
      const path = findElementPath(slide.elements, id);
      if (!path) {
        throw new Error(`[slides] group(): element not found: ${id}`);
      }
      paths.set(id, path);
    }

    // Invariant 3: all candidates must share the same parent.
    // The "parent key" is the id of the direct parent, or '' for slide root.
    const parentKeyOf = (id: string): string => {
      const path = paths.get(id)!;
      if (path.length === 1) return ''; // slide-root
      return path[path.length - 2].id;
    };
    const firstParentKey = parentKeyOf(elementIds[0]);
    for (const id of elementIds.slice(1)) {
      if (parentKeyOf(id) !== firstParentKey) {
        throw new Error(
          `[slides] group(): all elements must share the same parent`,
        );
      }
    }

    // Resolve the parent array (either slide.elements or a group's children).
    let parentArray: Element[];
    if (firstParentKey === '') {
      parentArray = slide.elements;
    } else {
      const parentPath = findElementPath(slide.elements, firstParentKey);
      if (!parentPath) {
        throw new Error(`[slides] group(): parent not found: ${firstParentKey}`);
      }
      const parentEl = parentPath[parentPath.length - 1];
      if (parentEl.type !== 'group') {
        throw new Error(`[slides] group(): parent is not a group: ${firstParentKey}`);
      }
      parentArray = parentEl.data.children;
    }

    // Resolve actual element objects in parent-array order.
    const candidateSet = new Set(elementIds);
    const allCandidatesInOrder = parentArray.filter(e => candidateSet.has(e.id));

    // Invariant 4: no placeholderRef on any candidate.
    for (const el of allCandidatesInOrder) {
      if (el.placeholderRef != null) {
        throw new Error(
          `[slides] group(): placeholderRef cannot be grouped (element ${el.id})`,
        );
      }
    }

    // Connector partition (v1 rule § 7):
    // A connector whose both endpoints are "internal" (either free or attached
    // to an element in the candidate set) joins the group.
    // A connector with at least one "external" attached endpoint is excluded.
    const internalCandidates: Element[] = [];
    const excludedConnectorIds: string[] = [];

    for (const el of allCandidatesInOrder) {
      if (el.type !== 'connector') {
        internalCandidates.push(el);
        continue;
      }
      const startInternal =
        el.start.kind === 'free' ||
        candidateSet.has(el.start.elementId);
      const endInternal =
        el.end.kind === 'free' ||
        candidateSet.has(el.end.elementId);
      if (startInternal && endInternal) {
        internalCandidates.push(el);
      } else {
        excludedConnectorIds.push(el.id);
        candidateSet.delete(el.id);
      }
    }

    // After excluding cross-group connectors, we need at least 2 elements.
    if (internalCandidates.length < 2) {
      throw new Error(
        `[slides] group(): cannot create a group: only ${internalCandidates.length} non-connector element(s) remain after excluding cross-group connectors`,
      );
    }

    const candidatesInOrder = internalCandidates;

    // Cycle prevention is structurally satisfied by the shared-parent invariant
    // (Invariant 3): because all candidates share the same parent, no candidate
    // can be an ancestor of another, so no runtime cycle check is needed here.

    // Compute the cumulative transform from slide-root to the parent's coordinate
    // space. If the shared parent is slide-root the cumulative transform is identity.
    // If the shared parent is a group, compose the chain of ancestor transforms.
    const ancestorTransform = resolveAncestorTransform(slide.elements, firstParentKey);

    // Compute world frames for each candidate using the ancestor transform.
    // For a slide-root parent the ancestor transform is identity, so world ≡ frame.
    // For a parent that is a group, the ancestor transform brings group-local coords
    // into world space.
    const worldFrames = candidatesInOrder.map(el =>
      applyFrameWithTransform(el.frame, ancestorTransform),
    );

    // Compute the rotated-corner AABB over all world frames.
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
    // Clamp to at least 1px to prevent a degenerate (singular) group transform.
    // A zero-width or zero-height group would produce a non-invertible matrix,
    // causing NaN/Infinity when normalizing child frames via applyInverseMatrix.
    const MIN_GROUP_DIM = 1;
    const groupWorldFrame: Frame = {
      x: minX, y: minY,
      w: Math.max(maxX - minX, MIN_GROUP_DIM),
      h: Math.max(maxY - minY, MIN_GROUP_DIM),
      rotation: 0,
    };

    // Build the new GroupElement. Children's frames are group-local.
    // The new group lives in the same coordinate space as the candidates
    // (the parent's local space). Convert the group's world frame back to
    // that local space using the inverse of the ancestor transform, then
    // normalize each child into group-local.
    const groupLocalFrame = applyInverseMatrix(groupWorldFrame, ancestorTransform);

    // Temporary GroupElement used to compute normalizeToGroupLocal.
    // We need a GroupElement with the world-frame geometry for the helper.
    const tempGroup: GroupElement = {
      id: '__tmp__',
      type: 'group',
      frame: groupWorldFrame,
      data: { children: [] },
    };

    // The group's transform maps group-local → world space. We need to
    // normalize connector free endpoints (which are in the same coordinate
    // space as their parent, i.e. world space for slide-root candidates) into
    // the new group-local space.
    // For slide-root candidates: endpoints are already in world space.
    // For candidates inside a parent group: endpoints are in parent-local space
    //   which equals world space after applying ancestorTransform.
    // Since candidatesInOrder all live in the same parent space, and the
    // tempGroup is in world space, we first bring candidate coords to world
    // (via ancestorTransform) then invert the group's own world transform.
    const groupSelfTransform = groupToTransform(tempGroup);
    const childrenWithLocalFrames: Element[] = candidatesInOrder.map((el, i) => {
      const cloned = clone(el);
      const localFrame = normalizeToGroupLocal(worldFrames[i], tempGroup);
      if (cloned.type === 'connector') {
        // Normalize free endpoint coordinates from world space to group-local.
        for (const side of ['start', 'end'] as const) {
          const ep = cloned[side];
          if (ep.kind === 'free') {
            // The endpoint coords are in parent-local space; bring to world
            // using ancestorTransform, then invert into the new group-local space.
            const worldPt = applyGroupTransformToPoint(ep.x, ep.y, ancestorTransform);
            const local = applyInversePoint(worldPt.x, worldPt.y, groupSelfTransform);
            cloned[side] = { kind: 'free', x: local.x, y: local.y };
          }
        }
      }
      return { ...cloned, frame: localFrame };
    });

    const groupId = generateId();
    const newGroup: GroupElement = {
      id: groupId,
      type: 'group',
      frame: groupLocalFrame,
      data: {
        children: childrenWithLocalFrames,
        // Anchor the local coordinate space. Children are stored with
        // frames relative to (0..refSize.w × 0..refSize.h). When the
        // group is resized, frame.w/h diverges from refSize; the
        // renderer scales children proportionally (OOXML chExt/ext semantics).
        refSize: { w: groupLocalFrame.w, h: groupLocalFrame.h },
      },
    };

    // Invariant 6: insert the group at the position of the front-most
    // (highest index) selected element in the parent array, remove candidates.
    const candidateIndices = candidatesInOrder.map(el =>
      parentArray.findIndex(p => p.id === el.id),
    );
    const frontMostIndex = Math.max(...candidateIndices);

    // Remove all candidates from the parent array.
    for (const el of candidatesInOrder) {
      const idx = parentArray.findIndex(p => p.id === el.id);
      if (idx !== -1) parentArray.splice(idx, 1);
    }

    // Insert the new group at the adjusted position.
    // After removals, how many elements before frontMostIndex were removed?
    const removedBefore = candidateIndices.filter(i => i < frontMostIndex).length;
    const insertAt = Math.max(0, frontMostIndex - removedBefore);
    parentArray.splice(insertAt, 0, newGroup);

    return { groupId, excludedConnectorIds };
  }

  ungroup(slideId: string, groupId: string): string[] {
    this.requireBatch();

    const slide = this.requireSlide(slideId);

    // Step 1: locate the group in the slide's element tree.
    const path = findElementPath(slide.elements, groupId);
    if (!path) {
      throw new Error(`[slides] ungroup(): element not found: ${groupId}`);
    }

    // Step 2: verify the target is a group.
    const group = path[path.length - 1];
    if (group.type !== 'group') {
      throw new Error(`[slides] ungroup(): element ${groupId} is not a group`);
    }

    // Step 3: resolve the parent array.
    // The parent is either slide.elements (if the group is at slide root)
    // or a GroupElement's children array (for a nested group).
    let parentArray: Element[];
    if (path.length === 1) {
      // Group is at the slide root.
      parentArray = slide.elements;
    } else {
      // Group is nested inside another group — the immediate parent is
      // the second-to-last element in the path.
      const parentEl = path[path.length - 2];
      // By the findElementPath invariant, a non-root ancestor must be a group.
      // No runtime check needed — if the invariant breaks, the splice below
      // will naturally produce incorrect output, caught by tests.
      parentArray = (parentEl as GroupElement).data.children;
    }

    // Step 4: find the group's current index in its parent array.
    const groupIndex = parentArray.findIndex(e => e.id === groupId);
    // Unreachable: findElementPath succeeded, so the group must be in the
    // parent array we derived from the same path.

    // Step 5: bake the group's transform into each child's frame.
    // applyGroupTransform converts a child's group-local frame into the
    // group's parent (= "one level up") coordinate space — exactly what we
    // need for a one-level-only ungroup. Grandchildren stay in their own
    // group-local space (their parent group's frame moves, not their own).
    // For connectors, also transform free endpoints from group-local to
    // parent space so line geometry stays correct after ungroup.
    const groupTx = groupToTransform(group as GroupElement);
    const bakedChildren: Element[] = group.data.children.map(child => {
      const cloned = clone(child);
      cloned.frame = applyGroupTransform(child.frame, group as GroupElement);
      if (cloned.type === 'connector') {
        for (const side of ['start', 'end'] as const) {
          const ep = cloned[side];
          if (ep.kind === 'free') {
            const world = applyGroupTransformToPoint(ep.x, ep.y, groupTx);
            cloned[side] = { kind: 'free', x: world.x, y: world.y };
          }
        }
      }
      return cloned;
    });

    // Step 6: replace the group in the parent array with its children,
    // preserving z-order (children land at the group's slot, in their
    // existing order relative to each other).
    parentArray.splice(groupIndex, 1, ...bakedChildren);

    // Step 7: return child ids so the caller can restore selection.
    return bakedChildren.map(c => c.id);
  }

  refitGroup(slideId: string, groupId: string): void {
    this.requireBatch();

    const slide = this.requireSlide(slideId);
    const path = findElementPath(slide.elements, groupId);
    if (!path) return; // Tolerant: stale group id (remote delete) → no-op.

    const group = path[path.length - 1];
    if (group.type !== 'group') return;
    if (group.data.children.length === 0) return;

    // The shared `worldTightFrame` math computes the rotation-preserving
    // tight world frame plus the local shift that needs to be applied to
    // every child so the new local origin sits at the children's AABB
    // corner. Children's world positions stay invariant by construction.
    const tight = worldTightFrame(group);
    const { worldFrame: newFrame, localShift, newRefSize } = tight;

    const EPS = 0.5;
    const close = (a: number, b: number) => Math.abs(a - b) < EPS;
    if (
      close(localShift.x, 0) &&
      close(localShift.y, 0) &&
      close(newRefSize.w, group.data.refSize?.w ?? group.frame.w) &&
      close(newRefSize.h, group.data.refSize?.h ?? group.frame.h)
    ) {
      // Local AABB already aligned with the local origin AND tight against
      // refSize — nothing to refit. Rotation/scale are preserved by design,
      // so we do not need to mutate them in the no-op path.
      return;
    }

    // Mutate the existing group in place — keeping object identity matters
    // for Yorkie path stability across sibling mutations in the same batch.
    group.frame = { ...newFrame };
    group.data.refSize = { ...newRefSize };

    // Shift each child's local frame by (-localShift) so it sits in the
    // new (0..newRefSize) local box. Children's world positions are
    // preserved because `newFrame` was solved to make T_new(P_old - shift)
    // == T_old(P_old) for every child point P_old.
    for (const ch of group.data.children) {
      ch.frame = {
        ...ch.frame,
        x: ch.frame.x - localShift.x,
        y: ch.frame.y - localShift.y,
      };
      if (ch.type === 'connector') {
        for (const side of ['start', 'end'] as const) {
          const ep = ch[side];
          if (ep.kind === 'free') {
            ch[side] = {
              kind: 'free',
              x: ep.x - localShift.x,
              y: ep.y - localShift.y,
            };
          }
        }
      }
    }
  }

  // --- text bridges ---

  withTextElement(
    slideId: string, elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'text') {
      throw new Error(`Element ${elementId} is not a text element`);
    }
    const next = fn(e.data.blocks);
    if (next !== undefined) {
      e.data.blocks = clone(next);
    }
  }

  withShapeText(
    slideId: string, elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'shape') {
      throw new Error(`Element ${elementId} is not a shape element`);
    }
    // Seed an empty body on first entry so `fn` always receives the
    // canonical mutable handle.
    const prior = e.data.text?.blocks ?? [];
    const returned = fn(prior);
    const next = returned !== undefined ? clone(returned) : prior;
    // Concurrency-safety contract (mirrors `withTextElement.blocks`):
    // we only ever write the `data.text.blocks` field — we do NOT
    // delete the whole `data.text` field on empty commits. A blur on
    // an empty body must not race against a peer's typing in a way
    // that wipes their text wholesale (deleting `data.text` is a
    // wholesale-field LWW op; writing `{ ...text, blocks: [] }` is a
    // per-field LWW op symmetric with what `withTextElement` does).
    //
    // The one shortcut: if the shape entered the edit with no body and
    // exits with no body (click-in-and-out without typing), we skip
    // the write entirely so we don't materialise an empty body on
    // shapes the user never typed into. Existing bodies that the user
    // cleared retain an empty body (visually invisible — the renderer
    // short-circuits via `isBlocksEmpty`).
    if (isBlocksEmpty(next) && isBlocksEmpty(prior) && e.data.text === undefined) {
      return;
    }
    e.data.text = { ...e.data.text, blocks: next };
  }

  insertTableRow(slideId: string, elementId: string, atIndex: number): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'table') {
      throw new Error(`Element ${elementId} is not a table`);
    }
    const nRows = e.data.rows.length;
    if (atIndex < 0 || atIndex > nRows) {
      throw new Error(
        `insertTableRow: atIndex ${atIndex} out of range [0, ${nRows}]`,
      );
    }
    // Inherit the height of the adjacent row so the new row visually
    // matches its neighbour. Falls back to 30 px when the table is
    // empty — close to a single typical body-text line at the default
    // 14 pt scale.
    const inheritFrom = e.data.rows[atIndex - 1] ?? e.data.rows[atIndex];
    const height = inheritFrom?.height ?? 30;
    const cells: TableCell[] = e.data.columnWidths.map(() => ({
      body: { blocks: [] },
      style: {},
    }));
    e.data.rows.splice(atIndex, 0, { height, cells });
    // Preserve `frame.h == sum(row.height)` (CR#13 invariant). Width
    // is unaffected — inserting a row doesn't change column widths.
    e.frame = { ...e.frame, h: e.frame.h + height };
  }

  insertTableColumn(
    slideId: string,
    elementId: string,
    atIndex: number,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'table') {
      throw new Error(`Element ${elementId} is not a table`);
    }
    const nCols = e.data.columnWidths.length;
    if (atIndex < 0 || atIndex > nCols) {
      throw new Error(
        `insertTableColumn: atIndex ${atIndex} out of range [0, ${nCols}]`,
      );
    }
    const inheritWidth =
      e.data.columnWidths[atIndex - 1] ?? e.data.columnWidths[atIndex] ?? 100;
    e.data.columnWidths.splice(atIndex, 0, inheritWidth);
    for (const row of e.data.rows) {
      row.cells.splice(atIndex, 0, { body: { blocks: [] }, style: {} });
    }
    e.frame = { ...e.frame, w: e.frame.w + inheritWidth };
  }

  deleteTableRow(slideId: string, elementId: string, atIndex: number): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'table') {
      throw new Error(`Element ${elementId} is not a table`);
    }
    const nRows = e.data.rows.length;
    if (atIndex < 0 || atIndex >= nRows) {
      throw new Error(
        `deleteTableRow: atIndex ${atIndex} out of range [0, ${nRows - 1}]`,
      );
    }
    if (nRows <= 1) {
      throw new Error(
        'deleteTableRow: cannot remove the last row of a table',
      );
    }
    const removedHeight = e.data.rows[atIndex].height;
    // Decrement rowSpan on anchors in earlier rows whose span covers
    // (i.e. extends past) the deleted row. Walk every row above the
    // deletion; anchors live in those rows; covered cells are skipped.
    for (let r = 0; r < atIndex; r++) {
      const row = e.data.rows[r];
      for (let c = 0; c < row.cells.length; c++) {
        const cell = row.cells[c];
        if (!cell) continue;
        const rs = cell.rowSpan;
        if (rs === undefined || rs <= 1) continue;
        if (r + rs > atIndex) {
          cell.rowSpan = rs - 1;
        }
      }
    }
    e.data.rows.splice(atIndex, 1);
    e.frame = { ...e.frame, h: e.frame.h - removedHeight };
  }

  deleteTableColumn(
    slideId: string,
    elementId: string,
    atIndex: number,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'table') {
      throw new Error(`Element ${elementId} is not a table`);
    }
    const nCols = e.data.columnWidths.length;
    if (atIndex < 0 || atIndex >= nCols) {
      throw new Error(
        `deleteTableColumn: atIndex ${atIndex} out of range [0, ${nCols - 1}]`,
      );
    }
    if (nCols <= 1) {
      throw new Error(
        'deleteTableColumn: cannot remove the last column of a table',
      );
    }
    const removedWidth = e.data.columnWidths[atIndex];
    // Decrement gridSpan on anchors in earlier columns of the SAME row
    // whose span covers the deleted column. Iterate every row; anchor
    // lookup is local to that row.
    for (const row of e.data.rows) {
      for (let c = 0; c < atIndex; c++) {
        const cell = row.cells[c];
        if (!cell) continue;
        const gs = cell.gridSpan;
        if (gs === undefined || gs <= 1) continue;
        if (c + gs > atIndex) {
          cell.gridSpan = gs - 1;
        }
      }
      row.cells.splice(atIndex, 1);
    }
    e.data.columnWidths.splice(atIndex, 1);
    e.frame = { ...e.frame, w: e.frame.w - removedWidth };
  }

  withTableCellBody(
    slideId: string,
    elementId: string,
    row: number,
    col: number,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'table') {
      throw new Error(`Element ${elementId} is not a table`);
    }
    const cell = e.data.rows[row]?.cells[col];
    if (!cell) {
      throw new Error(
        `Cell (${row}, ${col}) not found on table ${elementId}`,
      );
    }
    if (cell.gridSpan === 0 || cell.rowSpan === 0) {
      throw new Error(
        `Cell (${row}, ${col}) is covered by a merge; resolve to the merge anchor first`,
      );
    }
    const next = fn(cell.body.blocks);
    if (next !== undefined) {
      cell.body.blocks = clone(next);
    }
  }

  withNotes(
    slideId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const next = fn(slide.notes);
    if (next !== undefined) {
      slide.notes = clone(next);
    }
  }

  // --- guides ---

  addGuide(axis: GuideAxis, position: number): string {
    this.requireBatch();
    assertFinitePosition('addGuide', position);
    const id = generateId();
    const guide: Guide = { id, axis, position };
    this.doc.guides.push(guide);
    return id;
  }

  moveGuide(id: string, position: number): void {
    this.requireBatch();
    assertFinitePosition('moveGuide', position);
    const guide = this.doc.guides.find((g) => g.id === id);
    if (!guide) throw new Error(`Guide not found: ${id}`);
    guide.position = position;
  }

  removeGuide(id: string): void {
    this.requireBatch();
    const idx = this.doc.guides.findIndex((g) => g.id === id);
    if (idx === -1) throw new Error(`Guide not found: ${id}`);
    this.doc.guides.splice(idx, 1);
  }

  // --- transactions ---

  batch(fn: () => void): void {
    if (this.batchDepth === 0) {
      this.undoStack.push(clone(this.doc));
      this.redoStack = [];
    }
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
    }
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.redoStack.push(clone(this.doc));
    this.doc = this.undoStack.pop()!;
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.undoStack.push(clone(this.doc));
    this.doc = this.redoStack.pop()!;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  // --- internal helpers ---

  private requireSlide(slideId: string): Slide {
    return this.doc.slides[this.requireSlideIndex(slideId)];
  }

  private requireSlideIndex(slideId: string): number {
    const i = this.doc.slides.findIndex((s) => s.id === slideId);
    if (i === -1) throw new Error(`Slide not found: ${slideId}`);
    return i;
  }

  /**
   * DFS-find an element anywhere in the slide tree. Throws if not found.
   * Use this in place of the flat `requireElementIndex` so mutations work
   * on both slide-root and nested (grouped) elements.
   */
  private requireElement(slide: Slide, elementId: string): Element {
    const path = findElementPath(slide.elements, elementId);
    if (!path) throw new Error(`Element not found: ${elementId}`);
    return path[path.length - 1];
  }

  /**
   * Given a full path to an element (from findElementPath), return the
   * mutable array that directly contains the element.
   * - path.length === 1  → slide.elements (slide root)
   * - path.length >= 2   → the immediate parent group's children array
   */
  private resolveParentArray(slide: Slide, path: Element[]): Element[] {
    if (path.length === 1) return slide.elements;
    const parent = path[path.length - 2];
    // By the findElementPath invariant, non-root ancestors are always groups.
    return (parent as GroupElement).data.children;
  }

  /**
   * After removing element(s), walk the ancestor path upward and splice
   * any group that has become empty. Recurse until we reach the slide root
   * or encounter a non-empty group.
   *
   * `path` is the pre-removal path of the removed element (including the
   * removed element itself at the end). We walk from the parent upward.
   *
   * Because all removal calls happen inside `requireBatch()`, this runs in
   * the same batch so a single undo restores the entire tree.
   */
  private pruneEmptyAncestorGroups(slide: Slide, path: Element[]): void {
    // Ancestors are all elements in the path except the leaf (which was
    // removed) and the leaf's id. We walk from the immediate parent
    // upward toward the slide root.
    for (let depth = path.length - 2; depth >= 0; depth--) {
      const ancestor = path[depth];
      if (ancestor.type !== 'group') break;
      if (ancestor.data.children.length > 0) break;
      // This group is now empty — remove it from ITS parent.
      const ancestorParentArray =
        depth === 0 ? slide.elements : (path[depth - 1] as GroupElement).data.children;
      const idx = ancestorParentArray.findIndex((e) => e.id === ancestor.id);
      if (idx !== -1) ancestorParentArray.splice(idx, 1);
    }
  }

  private requireBatch(): void {
    if (this.batchDepth === 0) {
      throw new Error('Mutations must be wrapped in batch()');
    }
  }

  /** Read-only id → Element map (with world frames) for the given slide. */
  private elementsLookup(slideId: string): ReadonlyMap<string, Element> {
    const i = this.doc.slides.findIndex((s) => s.id === slideId);
    if (i === -1) return new Map();
    return buildElementWorldLookup(this.doc.slides[i].elements);
  }

  /**
   * For every connector on `slide` whose `start` or `end` is attached
   * to `targetId`, convert that endpoint to a `free` endpoint pinned at
   * the endpoint's current world position, then refresh the connector's
   * cached `frame`. Caller must invoke this *before* removing the target
   * so attached `siteWorldPos` still resolves to a defined location.
   */
  private detachConnectorsTargeting(slide: Slide, targetId: string): void {
    const allElements = flattenElements(slide.elements);
    const lookup = buildElementWorldLookup(slide.elements);
    for (const el of allElements) {
      if (el.type !== 'connector') continue;
      let mutated = false;
      for (const side of ['start', 'end'] as const) {
        const ep = el[side];
        if (ep.kind === 'attached' && ep.elementId === targetId) {
          const w = resolveEndpoint(ep, lookup);
          el[side] = { kind: 'free', x: w.x, y: w.y };
          mutated = true;
        }
      }
      if (mutated) {
        // Reuse the outer `lookup` — `computeConnectorFrame` only
        // consults it for `attached` endpoints, and we just rewrote
        // both touched endpoints to `free`, so rebuilding the Map
        // would be pure overhead.
        el.frame = computeConnectorFrame(el, lookup);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers for group() math
// ---------------------------------------------------------------------------

/**
 * Compose a chain of group transforms from the slide-root down to a given
 * parent id. Returns the identity transform when `parentId` is '' (slide root).
 * The result maps the parent's local coordinates to world coordinates.
 *
 * Throws if `parentId` is non-empty but the path is not found — the
 * same-parent invariant has already validated existence by this point, so a
 * missing path indicates a programming error rather than a user error.
 */
function resolveAncestorTransform(
  slideElements: Element[],
  parentId: string,
): GroupTransform {
  if (parentId === '') return { ...IDENTITY_GROUP_TRANSFORM };

  // Walk findElementPath to build the ancestor chain from root → parent.
  const path = findElementPath(slideElements, parentId);
  if (!path) {
    throw new Error(`[slides] group(): parentId not found on slide: ${parentId}`);
  }

  // Collect only the GroupElement ancestors (all entries in `path` for a
  // group parent will be groups up to and including the parent itself).
  const groupAncestors = path.filter((el): el is GroupElement => el.type === 'group');

  // Delegate to the canonical helper in model/group.ts.
  return composeAncestorTransform(groupAncestors);
}

/**
 * Apply a GroupTransform to a Frame's center point and produce a world frame.
 * For slide-root children the transform is identity, so this is a no-op.
 * Delegates to `applyMatrix` (the PPTX-import helper) for consistency.
 */
function applyFrameWithTransform(frame: Frame, t: GroupTransform): Frame {
  return applyMatrix(frame, t);
}

/**
 * Return the 4 corners of a frame (accounting for rotation around its center).
 * Used to compute the tight AABB over all rotated candidate frames.
 */
function frameCorners(frame: Frame): [number, number][] {
  const { x, y, w, h, rotation } = frame;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hw = w / 2;
  const hh = h / 2;
  // Corners relative to center, then rotated, then translated to world.
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
