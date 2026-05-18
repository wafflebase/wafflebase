import type { SlidesStore } from './store';
import type {
  Background,
  Slide,
  SlidesDocument,
} from '../model/presentation';
import type { Block } from '@wafflebase/docs';
import type { ArrowheadStyle, Endpoint } from '../model/connector';
import type { Stroke } from '../model/element';
import type { Element, ElementInit, Frame, GroupElement } from '../model/element';
import { generateId } from '../model/element';
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
  composeAncestorTransform,
  findElementPath,
  normalizeToGroupLocal,
} from '../model/group';
import type { GroupTransform } from '../model/group';
import { applyGroupTransform as applyMatrix } from '../import/pptx/group';

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
            cloned.data = { blocks: seedPlaceholderBlocks(placeholderStyle, theme) };
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

  addElement(slideId: string, init: ElementInit): string {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const id = generateId();
    const element = { ...clone(init), id } as Element;
    // Connectors carry a derived `frame` cache; the insert call path uses
    // `buildConnectorInit` which pre-fills it correctly, but any future
    // paste/import path could persist a degenerate `{0,0,0,0}` frame and
    // silently break the selection bbox. Recompute defensively here so
    // the cache is always derived from the endpoints.
    if (element.type === 'connector') {
      const lookup = new Map(slide.elements.map((e) => [e.id, e] as const));
      element.frame = computeConnectorFrame(element, lookup);
    }
    slide.elements.push(element);
    return id;
  }

  removeElement(slideId: string, elementId: string): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const i = this.requireElementIndex(slide, elementId);
    // Cascade sweep — any connector still attached to the element being
    // removed must convert that endpoint to a `free` endpoint pinned at
    // the endpoint's *current* world position, so the connector survives
    // source deletion without snapping to the origin. (Q4 c1 policy.)
    // We compute the world position *before* removing the source from the
    // lookup so attached siteWorldPos still resolves.
    this.detachConnectorsTargeting(slide, elementId);
    slide.elements.splice(i, 1);
  }

  removeElements(slideId: string, elementIds: string[]): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const set = new Set(elementIds);
    // Cascade sweep — convert any endpoint attached to one of the
    // about-to-be-removed elements into a free endpoint at its last
    // world position before any source is dropped.
    for (const id of set) {
      this.detachConnectorsTargeting(slide, id);
    }
    slide.elements = slide.elements.filter((e) => !set.has(e.id));
  }

  updateElementFrame(
    slideId: string, elementId: string, frame: Partial<Frame>,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    if (e.type === 'connector') {
      // Connector frame is derived from endpoint positions — patching it
      // directly would leave the cached bbox out of sync with the
      // endpoints. Callers must mutate endpoints via
      // `updateConnectorEndpoint`, which recomputes the frame for them.
      throw new Error(
        `Element ${elementId} is a connector; update its endpoints instead of its frame`,
      );
    }
    e.frame = { ...e.frame, ...frame };
    // Recompute cached frames of connectors whose endpoints attach to
    // this element. The renderer reads endpoints live, so the visual
    // line already follows the source move — but selection bbox /
    // hit-testing uses the cached `frame`, which must stay fresh.
    // This is derived state; the snapshot-based undo already restores
    // the prior frame from the pre-batch snapshot.
    const lookup = this.elementsLookup(slideId);
    for (const el of slide.elements) {
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
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
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
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
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
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
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
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    if (stroke === undefined) {
      delete e.stroke;
    } else {
      e.stroke = clone(stroke);
    }
  }

  reorderElement(
    slideId: string, elementId: string, toIndex: number,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const from = this.requireElementIndex(slide, elementId);
    const [el] = slide.elements.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, slide.elements.length));
    slide.elements.splice(clamped, 0, el);
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
    const candidatesInOrder = parentArray.filter(e => candidateSet.has(e.id));

    // Invariant 4: no placeholderRef on any candidate.
    for (const el of candidatesInOrder) {
      if (el.placeholderRef != null) {
        throw new Error(
          `[slides] group(): placeholderRef cannot be grouped (element ${el.id})`,
        );
      }
    }

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
    const groupWorldFrame: Frame = {
      x: minX, y: minY,
      w: maxX - minX, h: maxY - minY,
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

    const childrenWithLocalFrames: Element[] = candidatesInOrder.map((el, i) => ({
      ...clone(el),
      frame: normalizeToGroupLocal(worldFrames[i], tempGroup),
    }));

    const groupId = generateId();
    const newGroup: GroupElement = {
      id: groupId,
      type: 'group',
      frame: groupLocalFrame,
      data: { children: childrenWithLocalFrames },
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

    return { groupId, excludedConnectorIds: [] };
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
    const bakedChildren: Element[] = group.data.children.map(child => ({
      ...clone(child),
      frame: applyGroupTransform(child.frame, group as GroupElement),
    }));

    // Step 6: replace the group in the parent array with its children,
    // preserving z-order (children land at the group's slot, in their
    // existing order relative to each other).
    parentArray.splice(groupIndex, 1, ...bakedChildren);

    // Step 7: return child ids so the caller can restore selection.
    return bakedChildren.map(c => c.id);
  }

  // --- text bridges ---

  withTextElement(
    slideId: string, elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    if (e.type !== 'text') {
      throw new Error(`Element ${elementId} is not a text element`);
    }
    const next = fn(e.data.blocks);
    if (next !== undefined) {
      e.data.blocks = clone(next);
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

  private requireElementIndex(slide: Slide, elementId: string): number {
    const i = slide.elements.findIndex((e) => e.id === elementId);
    if (i === -1) throw new Error(`Element not found: ${elementId}`);
    return i;
  }

  private requireBatch(): void {
    if (this.batchDepth === 0) {
      throw new Error('Mutations must be wrapped in batch()');
    }
  }

  /**
   * Read-only id → Element map for the given slide. Used by the
   * connector frame helpers to resolve attached endpoints.
   */
  private elementsLookup(slideId: string): ReadonlyMap<string, Element> {
    const i = this.doc.slides.findIndex((s) => s.id === slideId);
    if (i === -1) return new Map();
    const slide = this.doc.slides[i];
    return new Map(slide.elements.map((e) => [e.id, e] as const));
  }

  /**
   * For every connector on `slide` whose `start` or `end` is attached
   * to `targetId`, convert that endpoint to a `free` endpoint pinned at
   * the endpoint's current world position, then refresh the connector's
   * cached `frame`. Caller must invoke this *before* removing the target
   * so attached `siteWorldPos` still resolves to a defined location.
   */
  private detachConnectorsTargeting(slide: Slide, targetId: string): void {
    const lookup = new Map(slide.elements.map((e) => [e.id, e] as const));
    for (const el of slide.elements) {
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
