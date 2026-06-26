import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import { clone } from './clone';
import { generateId, isElementEmpty } from './element';
import type { Element, PlaceholderRef, PlaceholderType } from './element';
import type { Master } from './master';
import { seedPlaceholderBlocks } from './placeholder-blocks';
import type { Layout, PlaceholderSpec, Slide } from './presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './presentation';
import type { Theme } from './theme';

const PADDING = 80;
const W = SLIDE_WIDTH - PADDING * 2;
const HALF = (W - PADDING) / 2;

function emptyBlocks(): Block[] {
  return [
    {
      id: 'placeholder',
      type: 'paragraph',
      inlines: [{ text: '', style: {} }],
      // Fully-defaulted style — see `text-renderer.ts:drawText` for why
      // sparse styles cannot reach `computeLayout` (NaN'd cumulative y).
      style: { ...DEFAULT_BLOCK_STYLE },
    } as Block,
  ];
}

function textPlaceholder(
  type: PlaceholderType,
  x: number, y: number, w: number, h: number,
): PlaceholderSpec {
  return {
    type: 'text',
    frame: { x, y, w, h, rotation: 0 },
    data: { autofit: 'shrink', blocks: emptyBlocks() },
    placeholder: { type },
  };
}

/**
 * Compute the (type, index) slot identity for every placeholder in a
 * layout. Index is per-type — slots of the same type are numbered
 * 0, 1, 2 in array order. Used by both addSlide (stamping new
 * placeholder elements) and applyLayoutToSlide (matching ref-bearing
 * elements to slots) so the formula is shared.
 */
export function slotRefsForLayout(layout: Layout): PlaceholderRef[] {
  const counts = new Map<PlaceholderType, number>();
  return layout.placeholders.map((p) => {
    const type = p.placeholder.type;
    const index = counts.get(type) ?? 0;
    counts.set(type, index + 1);
    return { type, index };
  });
}

/** Built-in layouts — order is the order they appear in the toolbar.
 *
 * v1 layouts always carry `masterId: 'default'` and an empty
 * `staticElements` array (v1.5 populates static elements such as
 * decorative dividers, page numbers, and footer text). Geometry
 * mirrors Google Slides' eleven-layout default deck.
 */
export const BUILT_IN_LAYOUTS: Layout[] = [
  {
    id: 'blank',
    masterId: 'default',
    name: 'Blank',
    placeholders: [],
    staticElements: [],
  },
  {
    id: 'title-slide',
    masterId: 'default',
    name: 'Title slide',
    placeholders: [
      textPlaceholder('title', PADDING, SLIDE_HEIGHT / 2 - 120, W, 160),
      textPlaceholder('subtitle', PADDING, SLIDE_HEIGHT / 2 + 60, W, 80),
    ],
    staticElements: [],
  },
  {
    id: 'section-header',
    masterId: 'default',
    name: 'Section header',
    placeholders: [
      textPlaceholder('title', PADDING, SLIDE_HEIGHT / 2 - 80, W, 200),
    ],
    staticElements: [],
  },
  {
    id: 'title-body',
    masterId: 'default',
    name: 'Title and body',
    placeholders: [
      textPlaceholder('title', PADDING, PADDING, W, 140),
      textPlaceholder(
        'body',
        PADDING,
        PADDING + 180,
        W,
        SLIDE_HEIGHT - PADDING * 2 - 200,
      ),
    ],
    staticElements: [],
  },
  {
    id: 'title-two-columns',
    masterId: 'default',
    name: 'Title and two columns',
    placeholders: [
      textPlaceholder('title', PADDING, PADDING, W, 140),
      textPlaceholder(
        'body',
        PADDING,
        PADDING + 180,
        HALF,
        SLIDE_HEIGHT - PADDING * 2 - 200,
      ),
      textPlaceholder(
        'body',
        PADDING + HALF + PADDING,
        PADDING + 180,
        HALF,
        SLIDE_HEIGHT - PADDING * 2 - 200,
      ),
    ],
    staticElements: [],
  },
  {
    id: 'title-only',
    masterId: 'default',
    name: 'Title only',
    placeholders: [
      textPlaceholder('title', PADDING, PADDING, W, 140),
    ],
    staticElements: [],
  },
  {
    id: 'one-column-text',
    masterId: 'default',
    name: 'One column text',
    placeholders: [
      textPlaceholder('body', PADDING, PADDING, W, SLIDE_HEIGHT - PADDING * 2),
    ],
    staticElements: [],
  },
  {
    id: 'main-point',
    masterId: 'default',
    name: 'Main point',
    placeholders: [
      textPlaceholder('title', PADDING, SLIDE_HEIGHT / 2 - 80, W, 160),
    ],
    staticElements: [],
  },
  {
    id: 'section-title-description',
    masterId: 'default',
    name: 'Section title and description',
    placeholders: [
      textPlaceholder('title', PADDING, PADDING * 2, W, 180),
      textPlaceholder(
        'body',
        PADDING,
        PADDING * 2 + 220,
        W,
        SLIDE_HEIGHT - PADDING * 4 - 240,
      ),
    ],
    staticElements: [],
  },
  {
    id: 'caption',
    masterId: 'default',
    name: 'Caption',
    placeholders: [
      textPlaceholder('body', PADDING, PADDING, W, SLIDE_HEIGHT - PADDING * 2 - 200),
      textPlaceholder('caption', PADDING, SLIDE_HEIGHT - PADDING - 160, W, 120),
    ],
    staticElements: [],
  },
  {
    id: 'big-number',
    masterId: 'default',
    name: 'Big number',
    placeholders: [
      textPlaceholder('big-number', PADDING, SLIDE_HEIGHT / 2 - 200, W, 280),
      textPlaceholder('body', PADDING, SLIDE_HEIGHT / 2 + 100, W, 100),
    ],
    staticElements: [],
  },
];

/** Look up a built-in layout by id, defaulting to 'blank'. */
export function getLayout(layoutId: string): Layout {
  return BUILT_IN_LAYOUTS.find((l) => l.id === layoutId) ?? BUILT_IN_LAYOUTS[0];
}

/**
 * Stable synthetic slide id for layout-edit mode (PR3 commit 5). Derived
 * from the layout id so the same layout always maps to the same id —
 * `setCurrentSlide` short-circuits on an unchanged id, so a fixed id lets
 * the editor track which layout is being edited.
 */
export function layoutEditSlideId(layoutId: string): string {
  return `__layout__${layoutId}`;
}

/**
 * Deterministic element id for a layout placeholder, derived from its
 * `(type, index)` slot (PR3 commit 5). `buildLayoutSlide` stamps these so
 * the synthetic slide's element ids are stable across rebuilds — the
 * editor holds an element id between reading the slide and committing a
 * drag, so a fresh `generateId()` per build would break the ref mapping.
 */
export function placeholderElementId(ref: PlaceholderRef): string {
  return `__ph__${ref.type}_${ref.index}`;
}

/**
 * Materialize a transient Slide from a layout so the existing canvas
 * editor can render and drag its placeholders (PR3 commit 5). Each
 * placeholder becomes an element carrying its `(type, index)`
 * `placeholderRef`; the LayoutEditStore proxy maps a dragged element's ref
 * back to `updateLayoutPlaceholderFrame`. The slide is never persisted.
 *
 * Reuses `applyLayoutToSlide` so geometry and master/theme-seeded
 * typography match exactly what a real slide created from this layout
 * gets. Background is left empty (inherit) so the renderer resolves
 * layout→master→theme just as it does for live slides.
 */
export function buildLayoutSlide(
  layout: Layout,
  master: Master,
  theme: Theme,
): Slide {
  const slide: Slide = {
    id: layoutEditSlideId(layout.id),
    layoutId: layout.id,
    background: {},
    elements: [],
    notes: [],
  };
  applyLayoutToSlide(slide, layout, { master, theme });
  // Stamp deterministic ids so the synthetic slide is reproducible across
  // reads (applyLayoutToSlide assigns fresh generateId() ids).
  for (const el of slide.elements) {
    if (el.placeholderRef) el.id = placeholderElementId(el.placeholderRef);
  }
  return slide;
}

/**
 * Re-slot a slide for a new layout (mutates `slide`).
 *
 * 1. Partition existing elements by `placeholderRef`: ref-bearing
 *    elements compete for slots in `newLayout`; user-added elements
 *    (no ref) are never touched.
 * 2. For each new slot, find a ref-bearing element with matching
 *    `(type, index)`. On match, update its frame and ref to the new
 *    slot, preserving content. On miss, materialize a fresh empty
 *    placeholder element from the slot's spec.
 * 3. Orphans (ref-bearing but unmatched): empty → delete; non-empty
 *    → demote (drop `placeholderRef`, keep frame and content).
 *
 * Element array order is preserved: surviving placeholder elements
 * stay at their original positions, deletions are removed in place,
 * and fresh placeholders for unmatched slots are appended at the end.
 * This means the final element order may differ from
 * `newLayout.placeholders` order — by design, so user z-order across
 * layout switches is preserved.
 *
 * The user's `applyLayout` calls in both stores route here so the
 * semantics never diverge.
 */
export function applyLayoutToSlide(
  slide: Slide,
  newLayout: Layout,
  context?: { master: Master; theme: Theme },
): void {
  // Compute (type, index) for each new-layout slot using array order.
  const refs = slotRefsForLayout(newLayout);
  type Slot = { spec: PlaceholderSpec; ref: PlaceholderRef };
  const slots: Slot[] = newLayout.placeholders.map((spec, i) => ({
    spec,
    ref: refs[i],
  }));

  // First pass over the existing elements: decide each element's fate
  // (reuse / demote / delete / leave-alone) WITHOUT removing any. We
  // walk the elements in their current order so the consume order is
  // deterministic and identical to the previous (spread-based)
  // implementation.
  //
  // Why no spread / splice on existing entries: when `slide.elements`
  // is a Yorkie array proxy, the entries are themselves proxies. Both
  //
  //   1) `{ ...proxy, frame: ..., placeholderRef: ... }` — the spread
  //      pulls in non-serializable proxy methods (toJSON), and
  //   2) re-`splice`-ing the same proxy back in — Yorkie tries to
  //      serialize the array-proxy via `Object.entries`, which exposes
  //      the CRDTArray's internal state (a function-valued `elements`
  //      field), and rejects with "Unsupported type of value: function"
  //
  // both fail. So we mutate the live entry in place and only `splice`
  // for additions / deletions of full elements.
  type Reuse = { kind: 'reuse'; element: Element; slot: Slot };
  type Demote = { kind: 'demote'; element: Element };
  type Delete = { kind: 'delete'; index: number };
  const reuses: Reuse[] = [];
  const demotions: Demote[] = [];
  const deletions: Delete[] = [];
  const usedSlots = new Set<number>();

  for (let i = 0; i < slide.elements.length; i++) {
    const e = slide.elements[i];
    if (!e.placeholderRef) continue;
    const slotIdx = slots.findIndex(
      (s, si) =>
        !usedSlots.has(si)
        && s.ref.type === e.placeholderRef!.type
        && s.ref.index === e.placeholderRef!.index,
    );
    if (slotIdx >= 0) {
      usedSlots.add(slotIdx);
      reuses.push({ kind: 'reuse', element: e, slot: slots[slotIdx] });
    } else if (isElementEmpty(e)) {
      deletions.push({ kind: 'delete', index: i });
    } else {
      demotions.push({ kind: 'demote', element: e });
    }
  }

  slide.layoutId = newLayout.id;

  // Apply in-place mutations to surviving entries. Yorkie ObjectProxy
  // intercepts each assignment as a CRDT operation, so this correctly
  // emits per-field updates rather than a wholesale replace.
  for (const r of reuses) {
    r.element.frame = { ...r.slot.spec.frame };
    r.element.placeholderRef = r.slot.ref;
  }
  for (const d of demotions) {
    // `delete` emits a Yorkie remove-field op, whereas assigning
    // undefined leaves a "key with undefined value" set op. Both
    // pass our truthy partition above, but delete is the correct
    // CRDT semantic and matches yorkie-slides-store.ts.
    delete d.element.placeholderRef;
  }

  // Remove dead orphans — splice from the highest index down so earlier
  // indices stay valid. Single-element splices match how Yorkie array
  // proxies expect deletions; no fresh values are inserted, so there is
  // no proxy-rebuild risk here.
  deletions.sort((a, b) => b.index - a.index);
  for (const del of deletions) {
    slide.elements.splice(del.index, 1);
  }

  // Append fresh placeholders for slots that had no matching reuse.
  // These are plain JSON objects, so Yorkie can build their CRDT shape
  // cleanly.
  for (let si = 0; si < slots.length; si++) {
    if (usedSlots.has(si)) continue;
    const slot = slots[si];
    const cloned = clone(slot.spec) as PlaceholderSpec;
    // When a master+theme context is supplied and the slot is a text
    // placeholder, seed `data.blocks` with the slot's master typography
    // so typed characters inherit fontSize / fontFamily / color /
    // alignment / lineHeight from the very first keystroke. Without
    // this, the cloned-from-spec emptyBlocks() carries no inline
    // styling and the first typed character falls back to the docs
    // DEFAULT_INLINE_STYLE (11px Arial).
    if (context && cloned.type === 'text') {
      const placeholderStyle =
        context.master.placeholderStyles[slot.ref.type]
        ?? context.master.placeholderStyles.body;
      if (placeholderStyle) {
        // Preserve the cloned spec's `data` fields (notably `autofit`)
        // while replacing only `blocks` — a bare `data = { blocks }`
        // would drop the placeholder's seeded autofit mode.
        cloned.data = {
          ...cloned.data,
          blocks: seedPlaceholderBlocks(placeholderStyle, context.theme),
        };
      }
    }
    const fresh = {
      ...cloned,
      id: generateId(),
      placeholderRef: slot.ref,
    } as Element;
    slide.elements.push(fresh);
  }
}
