import type { Block } from '@wafflebase/docs';
import type {
  Background,
  GuideAxis,
  SlidesDocument,
} from '../model/presentation';
import type {
  ArrowheadStyle,
  ConnectorRouting,
  Endpoint,
} from '../model/connector';
import type { ElementInit, Frame, PlaceholderRef } from '../model/element';
import type { ColorScheme, FontScheme, Theme, ThemeColor } from '../model/theme';
import type { MasterBackgroundImage, PlaceholderStyle } from '../model/master';

/** LWW patch for a theme's editable fields (theme builder, PR3). */
export type ThemePatch = {
  name?: string;
  colors?: Partial<ColorScheme>;
  fonts?: Partial<FontScheme>;
};

/** LWW patch for a master's editable fields (theme builder, PR3). */
export type MasterPatch = {
  /** Merge background fill and/or image. Pass `image: null` to clear it. */
  background?: { fill?: ThemeColor; image?: MasterBackgroundImage | null };
  /** Per-key partial merge of placeholder type styles (title, body, …). */
  placeholderStyles?: Record<string, Partial<PlaceholderStyle>>;
};

/** LWW patch for a layout's editable fields (theme builder, PR3). */
export type LayoutPatch = {
  name?: string;
  /** Set the layout background override, or pass `null` to clear it. */
  background?: Background | null;
};

/**
 * SlidesStore — persistence abstraction for a presentation.
 *
 * Phase 1 ships only `MemSlidesStore`. The Yorkie-backed
 * `YorkieSlidesStore` arrives in Phase 4 in
 * `packages/frontend/src/app/slides/yorkie-slides-store.ts`.
 *
 * Mutations always go through this interface; the editor never
 * touches the underlying state directly.
 */
export interface SlidesStore {
  /** Return a deep clone of the current presentation. */
  read(): SlidesDocument;

  // --- slide-level ---

  /** Add a slide using the given layout. Returns the new slide id. */
  addSlide(layoutId: string, atIndex?: number): string;

  /** Deep-copy a slide and insert the copy immediately after it. */
  duplicateSlide(slideId: string): string;

  removeSlide(slideId: string): void;
  removeSlides(slideIds: string[]): void;

  moveSlide(slideId: string, toIndex: number): void;
  moveSlides(slideIds: string[], toIndex: number): void;

  updateSlideBackground(slideId: string, bg: Background): void;
  applyLayout(slideId: string, layoutId: string): void;

  /** Set (or clear, with undefined) a slide's transition effect. */
  setSlideTransition(slideId: string, transition: import('../model/presentation').SlideTransition | undefined): void;

  /** Append an object animation to a slide's sequence. Returns its id. */
  addAnimation(slideId: string, anim: import('../model/presentation').SlideAnimation): string;

  /** LWW-patch a single animation's scalar fields. The `id` field in `patch` is ignored — an animation's id is immutable. */
  updateAnimation(slideId: string, animId: string, patch: Partial<import('../model/element').ObjectAnimation>): void;

  /** Remove an animation from the slide's sequence. */
  removeAnimation(slideId: string, animId: string): void;

  /** Move an animation to `toIndex` within the slide's sequence (0 = first). */
  reorderAnimation(slideId: string, animId: string, toIndex: number): void;

  // --- theme-level ---

  /** Add a theme to the document. Idempotent on `theme.id`. */
  addTheme(theme: Theme): void;
  /** Apply a theme as the active theme. Theme must already be in `themes[]`. */
  applyTheme(themeId: string): void;

  // --- theme builder (master / layout / theme editing, PR3) ---

  /**
   * LWW-merge editable fields into an existing theme. Role-bound colors
   * and fonts re-resolve at render, so this cascades to all slides on
   * repaint. Throws if the theme is not in `themes[]`.
   */
  updateTheme(themeId: string, patch: ThemePatch): void;

  /**
   * LWW-merge editable fields into an existing master. Background fill is
   * read at render so it cascades on repaint; placeholder *type styles*
   * are seeded into slides at creation and need the commit-2 cascade to
   * reach existing slides. Throws if the master is not in `masters[]`.
   */
  updateMaster(masterId: string, patch: MasterPatch): void;

  /** LWW-merge name / background into an existing layout. Throws if not in `layouts[]`. */
  updateLayout(layoutId: string, patch: LayoutPatch): void;

  /**
   * Set the frame of the placeholder identified by `ref` (a (type,index)
   * slot) within a layout. New slides created from the layout honor the
   * edited geometry; existing slides need the commit-2 cascade. Throws if
   * the layout or the slot is missing.
   */
  updateLayoutPlaceholderFrame(
    layoutId: string,
    ref: PlaceholderRef,
    frame: Partial<Frame>,
  ): void;

  /**
   * Set the display unit for numeric inputs in the Format options
   * panel (and ruler, when wired). Persisted on `meta.unit` so peers
   * see the same preference. No effect on rendering.
   */
  setUnit(unit: 'in' | 'cm'): void;

  /**
   * Set the deck's logical slide height in px (width is fixed at
   * {@link SLIDE_WIDTH}). Persisted on `meta.slideHeight` and applied
   * deck-wide. Every top-level element on every slide is scaled
   * vertically by `newHeight / currentHeight` so content stays
   * proportionally placed (groups scale via their frame transform,
   * tables via row heights, connectors via their free endpoints).
   * A no-op when `height` equals the current height. One undo step.
   */
  setSlideHeight(height: number): void;

  /**
   * Record a recently used srgb color (hex) on `meta.recentColors`,
   * most-recent-first, de-duped and capped at `MAX_RECENT_COLORS`.
   * Persisted per document so collaborators share the same recents.
   * Only srgb colors are recorded — role colors are theme-relative.
   */
  pushRecentColor(hex: string): void;

  // --- element-level ---

  /**
   * Insert an element on a slide. Returns the new element id.
   *
   * When `parentGroupId` is provided the element is appended to that
   * group's `children` array instead of the slide root. Throws if
   * `parentGroupId` does not exist or is not a group element.
   */
  addElement(slideId: string, init: ElementInit, parentGroupId?: string): string;
  removeElement(slideId: string, elementId: string): void;
  removeElements(slideId: string, elementIds: string[]): void;
  updateElementFrame(
    slideId: string,
    elementId: string,
    frame: Partial<Frame>,
  ): void;
  updateElementData(
    slideId: string,
    elementId: string,
    patch: object,
  ): void;
  /** toIndex: 0 = back, length-1 = front. */
  reorderElement(slideId: string, elementId: string, toIndex: number): void;

  // --- group / ungroup ---

  /**
   * Wrap the given element ids in a new GroupElement.
   * All ids must exist on `slideId`, share the same parent (slide root or
   * one group), and carry no `placeholderRef`.
   * Returns `{ groupId, excludedConnectorIds }`.
   * `excludedConnectorIds` lists connectors from the selection that were
   * kept outside the new group (for example, connectors that cross the
   * group boundary or whose endpoints reference elements outside the selection).
   */
  group(
    slideId: string,
    elementIds: string[],
  ): { groupId: string; excludedConnectorIds: string[] };

  /**
   * Dissolve a GroupElement back into its parent. Each child's frame is
   * baked through the group's own transform once, so children land in the
   * group's immediate parent space (slide root or the enclosing group),
   * not in absolute slide-root space when the group itself was nested.
   * Returns the ids of the promoted children in their new z-order.
   */
  ungroup(slideId: string, groupId: string): string[];

  /**
   * Re-anchor a group's frame and local coordinate space to fit the
   * children's current visual extent. Called by the editor at "settle"
   * points (drill-out, click outside the drilled-in group) so that
   * `group.frame` stays consistent with what the user sees after moving
   * children around inside drill-in.
   *
   * The refit preserves the group's own rotation and scale (the math
   * is in `worldTightFrame` in `model/group.ts`); only the position +
   * dimensions move to wrap the children, and each child's local frame
   * is shifted by the children's local AABB offset so world positions
   * stay invariant across the refit.
   *
   * No-op when the group has no children, when the children's local
   * AABB already sits at (0, 0) with extent equal to refSize (sub-pixel
   * tolerance), or when the group does not exist on the slide.
   */
  refitGroup(slideId: string, groupId: string): void;

  /**
   * Bake a group's render-scale into its children, then reset `refSize`
   * to the group's current `frame.{w,h}`. Called at the commit point of
   * a group resize so the renderer no longer scales children at paint
   * time — text glyphs and any fixed-size content stop being distorted
   * under non-uniform group resizes. Matches Google Slides / PowerPoint
   * behaviour. No-op when the group has no children or when the scale
   * factors are already 1 (the gesture did not actually change size,
   * or `refSize` was unset).
   */
  bakeGroupResize(slideId: string, groupId: string): void;

  // --- connector-level ---

  /** Update an endpoint of an existing connector. */
  updateConnectorEndpoint(
    slideId: string,
    elementId: string,
    side: 'start' | 'end',
    endpoint: Endpoint,
  ): void;

  /** Replace a connector's arrowhead styles. Pass `null` per side to clear. */
  updateConnectorArrowheads(
    slideId: string,
    elementId: string,
    heads: {
      start?: ArrowheadStyle | null;
      end?:   ArrowheadStyle | null;
    },
  ): void;

  /**
   * Update a connector's stroke. Pass `undefined` to remove the stroke
   * (connector falls back to its default rendering style).
   */
  updateConnectorStroke(
    slideId: string,
    elementId: string,
    stroke: import('../model/element').Stroke | undefined,
  ): void;

  /**
   * Switch the routing topology of an existing connector (straight /
   * elbow / curved). Clears any persisted `elbowBend` on the way out of
   * elbow routing, and any persisted `curveBend` on the way out of
   * curved routing, so a future return to that topology starts from
   * its default cross-leg / control-distance.
   */
  updateConnectorRouting(
    slideId: string,
    elementId: string,
    routing: ConnectorRouting,
  ): void;

  /**
   * Persist a user-dragged elbow bend ratio (in [0, 1]). Pass `undefined`
   * to clear it and fall back to the default cross-leg position.
   */
  updateConnectorElbowBend(
    slideId: string,
    elementId: string,
    bend: number | undefined,
  ): void;

  /**
   * Persist a user-dragged curve bend factor on a curved-routed
   * connector. Pass `undefined` to clear it and fall back to the
   * default 1 (auto-routed control-point distance). Implementations
   * must clamp to `[CURVE_BEND_MIN, CURVE_BEND_MAX]` and round to keep
   * the CRDT payload tidy.
   */
  updateConnectorCurveBend(
    slideId: string,
    elementId: string,
    bend: number | undefined,
  ): void;

  // --- guides (presentation-wide) ---

  /**
   * Insert a presentation-wide alignment guide. Returns the new guide id.
   * Callers should clamp `position` into the slide's extent
   * (`[0, SLIDE_WIDTH]` for axis `'x'`, `[0, SLIDE_HEIGHT]` for `'y'`)
   * before calling; the store is geometry-agnostic.
   */
  addGuide(axis: GuideAxis, position: number): string;
  moveGuide(id: string, position: number): void;
  removeGuide(id: string): void;

  // --- text bridges (Phase 5 wires these to docs Tree) ---

  /** Mutate the rich-text body of a text element via the docs Tree. */
  withTextElement(
    slideId: string,
    elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void;
  /**
   * Mutate the optional inline text body of a shape element
   * (`data.text.blocks`). Implementations seed an empty body when
   * `data.text` is absent and drop the field again on commit if the
   * resulting blocks carry no visible characters, so freshly-inserted
   * shapes never accumulate empty `<p:txBody>` cruft.
   */
  withShapeText(
    slideId: string,
    elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void;
  /**
   * Mutate a single cell's `body.blocks` inside a TableElement. Mirrors
   * `withTextElement` / `withShapeText` so the slides text-bridge can
   * commit cell edits via the same Block[] surface.
   *
   * Throws when:
   *   - the element is missing or not a table
   *   - `(row, col)` is out of bounds for the cell grid
   *   - the cell is covered (`gridSpan === 0 || rowSpan === 0`) — covered
   *     cells have no editable body; the caller must resolve to the merge
   *     anchor first.
   */
  withTableCellBody(
    slideId: string,
    elementId: string,
    row: number,
    col: number,
    fn: (blocks: Block[]) => Block[] | void,
  ): void;
  /**
   * Insert a new row into a table at `atIndex`.
   *
   * - `atIndex === 0` prepends; `atIndex === rows.length` appends.
   * - The new row inherits the column count from `data.columnWidths`.
   *   Each new cell carries an empty `TextBody` and `{}` style;
   *   callers apply any further styling separately.
   * - The inserted row's height defaults to the height of the adjacent
   *   row (`rows[atIndex - 1]` if present, else `rows[atIndex]`, else
   *   30 px).
   * - `frame.h` is grown by the inserted row's height so the
   *   `frame.h == sum(row.height)` invariant established by P1 holds.
   *
   * Append-at-end is the only verified path so far (P3 wires it to the
   * Tab-from-last-cell UX). Mid-table inserts that would split an
   * existing `rowSpan > 1` merge currently leave the merge anchor's
   * `rowSpan` unchanged — proper merge-extension semantics arrive
   * with the full P4 structural ops.
   */
  insertTableRow(slideId: string, elementId: string, atIndex: number): void;
  /**
   * Insert a new column into a table at `atIndex`.
   *
   * - `atIndex === 0` prepends; `atIndex === columnWidths.length` appends.
   * - Each existing row gains one fresh cell at `cells[atIndex]` with
   *   empty body and `{}` style.
   * - The new column inherits the width of the adjacent column
   *   (`columnWidths[atIndex - 1]` if present, else `columnWidths[atIndex]`,
   *   else 100 px).
   * - `frame.w` grows by the inserted column's width.
   *
   * Like `insertTableRow`, mid-table inserts that would split an
   * existing `gridSpan > 1` merge are NOT handled yet — the anchor's
   * gridSpan stays unchanged, which may leave the new cell visually
   * over-counted in the merge. Append-at-end is the verified path.
   */
  insertTableColumn(slideId: string, elementId: string, atIndex: number): void;
  /**
   * Remove the row at `atIndex` from a table.
   *
   * - `frame.h` shrinks by the removed row's height.
   * - When the deletion crosses an existing `rowSpan > 1` merge anchor
   *   (anchor row is BEFORE `atIndex` and its span covered the deleted
   *   row), the anchor's `rowSpan` is decremented by 1 so the merge
   *   stays consistent.
   * - When the deletion removes the merge ANCHOR row itself, the
   *   covered cells in subsequent rows are left with `rowSpan: 0`
   *   markers pointing at a now-missing anchor. The renderer treats
   *   them as covered (invisible) until the user manually re-anchors.
   *   A future cleanup pass may promote the first covered row to a
   *   new anchor; not in this slice.
   *
   * Throws when called with `atIndex` out of range or when removing
   * the only row (a table must have at least one row).
   */
  deleteTableRow(slideId: string, elementId: string, atIndex: number): void;
  /**
   * Remove the column at `atIndex` from a table. Mirror of
   * `deleteTableRow`:
   * - `frame.w` shrinks by the removed column's width.
   * - `gridSpan > 1` anchors that crossed the deleted column have
   *   their gridSpan decremented by 1.
   * - Removing an anchor column orphans the covered cells in the
   *   same row (same caveat as deleteTableRow).
   *
   * Throws when `atIndex` is out of range or when removing the only
   * column.
   */
  deleteTableColumn(slideId: string, elementId: string, atIndex: number): void;
  /**
   * Merge a rectangular cell range `{r0, c0, r1, c1}` (inclusive on
   * both ends, accepts unordered endpoints) into a single anchor at
   * `(min(r0,r1), min(c0,c1))`. The anchor's `gridSpan` / `rowSpan`
   * become the range size; every other cell in the range gets
   * `gridSpan: 0` / `rowSpan: 0` (OOXML covered-cell encoding).
   *
   * The anchor's body is preserved; covered cells' bodies are
   * cleared. The anchor's style is preserved; covered cells' styles
   * are also cleared (the covered area visually belongs to the
   * anchor's paint).
   *
   * Throws when:
   *   - the range is empty (1×1) — merging a single cell is a no-op
   *     but reported as a misuse so callers don't accidentally merge
   *     "nothing" without realising
   *   - the range is out of the table's bounds
   *   - any cell inside the range is already covered by a DIFFERENT
   *     merge — the caller must unmerge that one first
   */
  mergeTableCells(
    slideId: string,
    elementId: string,
    range: { r0: number; c0: number; r1: number; c1: number },
  ): void;
  /**
   * Inverse of `mergeTableCells`: reset the merge anchor at `(row,
   * col)` and every cell it covered back to standalone cells (no
   * `gridSpan` / `rowSpan` set; bodies remain whatever they currently
   * hold, which for covered cells is the empty state `mergeTableCells`
   * left them in).
   *
   * Throws when `(row, col)` is not a merge anchor (i.e. its
   * `gridSpan ?? 1 === 1 && rowSpan ?? 1 === 1`).
   */
  unmergeTableCells(
    slideId: string,
    elementId: string,
    anchor: { row: number; col: number },
  ): void;
  /**
   * Patch a single cell's `style` object — LWW per key, not whole-
   * object replace. Keys present in `patch` overwrite or extend the
   * cell's existing style; keys explicitly set to `undefined` are
   * removed from the stored object. Other style keys (and the cell's
   * body / span markers) are left intact.
   *
   * Throws when `(row, col)` is out of bounds or the targeted cell
   * is covered (`gridSpan === 0 || rowSpan === 0`) — covered cells
   * have no visible paint of their own; the caller must resolve to
   * the merge anchor first.
   */
  updateTableCellStyle(
    slideId: string,
    elementId: string,
    row: number,
    col: number,
    patch: Partial<import('../model/element').CellStyle>,
  ): void;
  /**
   * Replace `data.columnWidths` atomically. `widths.length` must equal
   * the current column count; the implementation reshapes the array
   * (LWW on each width slot for Yorkie). `frame.w` is recomputed to
   * `sum(widths)` so the CR#13 invariant holds.
   *
   * Used by the column-border drag gesture (P4.7) and by future
   * "distribute columns evenly" commands.
   */
  updateTableColumnWidths(
    slideId: string,
    elementId: string,
    widths: readonly number[],
  ): void;
  /**
   * Replace each row's `height` atomically. `heights.length` must
   * equal the current row count; `frame.h` is recomputed to
   * `sum(heights)`.
   */
  updateTableRowHeights(
    slideId: string,
    elementId: string,
    heights: readonly number[],
  ): void;
  /** Mutate a slide's speaker notes via the docs Tree. */
  withNotes(
    slideId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void;

  // --- transactions / undo ---

  /** Group all mutations made inside `fn` into one undo entry. */
  batch(fn: () => void): void;

  // --- change notifications ---

  /**
   * Subscribe to store-level changes (e.g. Yorkie remote updates).
   * Optional: in-memory stores may omit this; the UI handles its
   * absence gracefully.
   */
  onChange?(cb: () => void): () => void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
