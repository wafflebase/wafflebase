import type { Block } from '@wafflebase/docs';
import type { ConnectorElement } from './connector';
import type { ThemeColor } from './theme';

export type Frame = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation around the element center, in radians. */
  rotation: number;
  /**
   * Horizontal/vertical mirroring around the frame centre, applied
   * after `rotation`. Optional so older serialized state (and
   * elements that never need a flip) keeps its current JSON shape;
   * absent ⇒ no flip. Matches OOXML `<a:xfrm flipH/flipV>` semantics
   * — the path is mirrored at paint time only, the frame rect is
   * unchanged so hit-test and selection box stay the same.
   */
  flipH?: boolean;
  flipV?: boolean;
};

/** Crop rectangle in image-relative coordinates (0..1 on each axis). */
export type Crop = { x: number; y: number; w: number; h: number };

export type ShapeKind =
  // Basic shapes (15 P1 + 3 regular polys + 4 sector/arc + 8 linear)
  | 'rect' | 'roundRect' | 'ellipse'
  | 'triangle' | 'rtTriangle'
  | 'diamond' | 'parallelogram' | 'trapezoid'
  | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon'
  | 'decagon' | 'dodecagon'
  | 'plus' | 'donut' | 'can' | 'cloud'
  | 'pie' | 'chord' | 'arc' | 'blockArc'
  | 'frame' | 'halfFrame' | 'corner' | 'diagStripe'
  | 'plaque' | 'bevel' | 'foldedCorner' | 'cube'
  | 'teardrop' | 'smileyFace' | 'heart' | 'lightningBolt'
  | 'sun' | 'moon' | 'noSmoking'
  // Snip / round-corner rects (7)
  | 'snip1Rect' | 'snip2SameRect' | 'snip2DiagRect' | 'snipRoundRect'
  | 'round1Rect' | 'round2SameRect' | 'round2DiagRect'
  // Block arrows (8 P1 + 4 T4a)
  | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow'
  | 'leftRightArrow' | 'quadArrow' | 'chevron' | 'pentagonArrow'
  | 'upDownArrow' | 'leftRightUpArrow'
  | 'notchedRightArrow' | 'stripedRightArrow'
  | 'bentArrow' | 'bentUpArrow' | 'uturnArrow' | 'swooshArrow'
  | 'circularArrow'
  | 'curvedRightArrow' | 'curvedLeftArrow'
  | 'curvedUpArrow' | 'curvedDownArrow'
  // Banners (5, P3-B T5)
  | 'ribbon' | 'ribbon2' | 'horizontalScroll' | 'verticalScroll'
  | 'leftRightRibbon'
  // Callouts (4 P1 + 3 line callouts + 7 arrow callouts)
  | 'wedgeRectCallout' | 'wedgeRoundRectCallout'
  | 'wedgeEllipseCallout' | 'cloudCallout'
  | 'borderCallout1' | 'borderCallout2' | 'borderCallout3'
  | 'rightArrowCallout' | 'leftArrowCallout'
  | 'upArrowCallout' | 'downArrowCallout'
  | 'leftRightArrowCallout' | 'upDownArrowCallout' | 'quadArrowCallout'
  // Brackets / braces (4) — open-path, stroke-oriented
  | 'leftBracket' | 'rightBracket' | 'leftBrace' | 'rightBrace'
  // Equation (6)
  | 'mathPlus' | 'mathMinus' | 'mathMultiply'
  | 'mathDivide' | 'mathEqual' | 'mathNotEqual'
  // Stars (6, P2)
  | 'star4' | 'star5' | 'star6' | 'star7' | 'star8' | 'star10'
  // Flowchart (14, P2)
  | 'flowChartTerminator' | 'flowChartPredefinedProcess'
  | 'flowChartInternalStorage' | 'flowChartDocument'
  | 'flowChartMultidocument' | 'flowChartManualInput'
  | 'flowChartManualOperation' | 'flowChartOffpageConnector'
  | 'flowChartPunchedCard' | 'flowChartPunchedTape'
  | 'flowChartSummingJunction' | 'flowChartOr'
  | 'flowChartDelay' | 'flowChartDisplay'
  // Action buttons (12 — P3-B T7) — special-cased renderer
  // (drawActionButton); not entered in PATH_BUILDERS.
  | 'actionButtonBlank' | 'actionButtonBackPrevious'
  | 'actionButtonForwardNext' | 'actionButtonBeginning'
  | 'actionButtonEnd' | 'actionButtonHome'
  | 'actionButtonInformation' | 'actionButtonReturn'
  | 'actionButtonMovie' | 'actionButtonSound'
  | 'actionButtonDocument' | 'actionButtonHelp';

/**
 * Stroke descriptor shared by ShapeElement, TextElement, and ConnectorElement.
 *
 * `color` accepts either a resolved hex/CSS string (used by the toolbar
 * redesign and all new editing paths) or a legacy ThemeColor discriminated
 * union (stored in older Yorkie documents before the toolbar redesign).
 * Renderers handle both via `resolveStrokeColor()` in render-context.ts.
 */
export type Stroke = {
  color: ThemeColor | string;
  width: number;
  dash?: 'solid' | 'dashed' | 'dotted';
};

/** @deprecated Use {@link Stroke} instead. Kept for type-level compatibility with ConnectorElement. */
export type ShapeStroke = Stroke;

export type PlaceholderType =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'caption'
  | 'big-number';

export type PlaceholderRef = {
  type: PlaceholderType;
  /** 0-based among same-type slots in the source layout. */
  index: number;
};

/**
 * Vertical position of laid-out content inside a text frame. Mirrors
 * OOXML `<a:bodyPr anchor>` (`t` / `ctr` / `b`).
 */
export type VerticalAnchorMode = 'top' | 'middle' | 'bottom';

/**
 * Text-box autofit behavior, mirroring OOXML `<a:bodyPr>` children:
 * - 'none'   ↔ <a:noAutofit/>   — box fixed, text overflows
 * - 'shrink' ↔ <a:normAutofit/> — box fixed, font auto-scales down to fit
 * - 'grow'   ↔ <a:spAutoFit/>   — font fixed, box height tracks content
 *
 * The shrink scale is derived live at render/edit time and never stored.
 * The grow height is written to `frame.h` on edit commit.
 */
export type AutofitMode = 'none' | 'shrink' | 'grow';

export type ElementBase = {
  id: string;
  frame: Frame;
  placeholderRef?: PlaceholderRef;
};

/**
 * Shared shape of a text body — the inline content plus the OOXML
 * `<a:bodyPr>`-equivalent props that govern its layout. Used as
 * `TextElement.data` (via intersection) and as `ShapeElement.data.text`
 * for shapes that carry inline text. Mirrors OOXML `<a:txBody>`.
 */
export type TextBody = {
  /** Domain-level read view; the Yorkie store backs this with a Tree. */
  blocks: Block[];
  /**
   * Autofit behavior. **Absent ⇒ `'grow'`** (the pre-autofit auto-grow
   * default established by the `slides-textbox-autogrow` feature) so
   * existing decks keep growing. Set `'none'` explicitly to disable
   * auto-grow; `'shrink'` to scale fonts to a fixed box. See
   * `docs/design/slides/slides-text-autofit.md`.
   */
  autofit?: AutofitMode;
  /**
   * Vertical position of the laid-out content inside the text frame.
   * Mirrors OOXML `<a:bodyPr anchor>`:
   * - `'top'` ↔ `anchor="t"` (and absent — preserves pre-feature behavior)
   * - `'middle'` ↔ `anchor="ctr"`
   * - `'bottom'` ↔ `anchor="b"`
   *
   * Imported from PPTX; the renderer translates the paint origin by
   * `(frame.h − layout.totalHeight) * factor` so content sits at the
   * top / middle / bottom of the frame.
   */
  verticalAnchor?: VerticalAnchorMode;
};

export type TextElement = ElementBase & {
  type: 'text';
  data: TextBody & {
    stroke?: Stroke;
    fill?: ThemeColor;
  };
};

export type ImageElement = ElementBase & {
  type: 'image';
  data: {
    src: string;
    crop?: Crop;
    alt?: string;
    /**
     * Pre-multiplied alpha applied at paint time. Range `[0, 1]`.
     * Imported from OOXML `<a:blip><a:alphaModFix amt="..."/>` (PPTX).
     * `undefined` / `1` paint at full opacity (no save/restore cost).
     */
    opacity?: number;
  };
};

export type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: ShapeKind;
    /**
     * OOXML-aligned per-shape adjustments (mirrors `<a:avLst><a:gd>`).
     * Path builders read this with sensible defaults when missing or
     * shorter than expected. Phase 1 has no editing UI; defaults are
     * used in practice. Stored from day one so P2/P3/P4 add edit UX
     * without data migration. Units are per-shape (typically OOXML
     * thousandths of the relevant dimension).
     */
    adjustments?: number[];
    fill?: ThemeColor;
    stroke?: Stroke;
    /**
     * Inline text body painted on top of the shape's fill/stroke.
     * Absent on freshly-inserted shapes; lazily initialised when the
     * user enters text-edit (double-click, Enter, or type-to-edit) and
     * dropped again on commit when the body ends up empty. Mirrors
     * OOXML `<p:sp>/<p:txBody>` for PPTX round-trip.
     */
    text?: TextBody;
  };
};

export type GroupElement = ElementBase & {
  type: 'group';
  data: {
    children: Element[]; // frames are in group-local coords (0..refSize × 0..refSize)
    /**
     * Reference dimensions of the group's local coordinate space.
     * Children's frames are stored in (0..refSize.w × 0..refSize.h).
     * The renderer scales (refSize → frame.w/h) so resizing the
     * group's frame visibly scales children proportionally — same
     * semantics as OOXML <a:chExt> vs <a:ext>.
     *
     * Optional for backward compatibility with documents created before
     * this field existed. Readers that find it undefined treat it as
     * { w: frame.w, h: frame.h } (scale = 1, identical to prior behavior).
     */
    refSize?: { w: number; h: number };
  };
  // Note: `placeholderRef` (inherited from ElementBase) is invalid on groups
  // and will be rejected at runtime by MemSlidesStore.group(). Placeholders
  // represent layout slots and are slide-direct only.
};

/**
 * Border descriptor for one side of a table cell. Mirrors OOXML
 * `<a:lnL/R/T/B>` — each side is independent, unlike the uniform stroke
 * on shapes / connectors. Absent ⇒ no rendered border on that side.
 */
export type CellBorder = {
  color: ThemeColor | string;
  /** Pixels. */
  width: number;
  dash?: 'solid' | 'dashed' | 'dotted';
};

export type CellStyle = {
  fill?: ThemeColor | string;
  border?: {
    top?: CellBorder;
    right?: CellBorder;
    bottom?: CellBorder;
    left?: CellBorder;
  };
  /**
   * Cell padding in pixels. Mirrors OOXML `<a:tcPr marL/R/T/B>`.
   * Absent keys fall back to `DEFAULT_CELL_PADDING`.
   */
  padding?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  /** Defaults to `'top'`. */
  verticalAlign?: VerticalAnchorMode;
};

/**
 * Default cell padding in pixels — matches the OOXML default
 * (`tcPr marL/R = 91440 EMU = ~8 px`, `marT/B = 45720 EMU = ~4 px`)
 * after the standard EMU→px conversion at 96 DPI.
 */
export const DEFAULT_CELL_PADDING = {
  top: 4,
  right: 8,
  bottom: 4,
  left: 8,
} as const;

export type TableCell = {
  /**
   * Rich-text body. Reuses the same `TextBody` engine used by
   * `TextElement.data` and `ShapeElement.data.text` so cell editing
   * goes through the existing text-bridge / IME / autofit paths.
   */
  body: TextBody;
  style: CellStyle;
  /**
   * 1 = unmerged. `> 1` = anchor cell of a horizontal merge spanning
   * `gridSpan` columns. `0` = covered cell (rendered as no-op).
   * Absent ⇒ `1`. Mirrors OOXML `<a:tc gridSpan>` / `<a:tc hMerge>`.
   *
   * **Importer contract:** PPTX has two encodings for covered cells —
   * `<a:tc hMerge='1'>` (used inside `<a:tblGrid>` regions) and
   * `<a:tc>` with `gridSpan` only on the anchor. Importers MUST
   * translate `hMerge` into `gridSpan: 0` on the covered cell;
   * renderers / store ops rely on the `=== 0` marker to skip painting
   * and exclude the cell from edge / span resolution.
   */
  gridSpan?: number;
  /**
   * 1 = unmerged. `> 1` = anchor cell of a vertical merge spanning
   * `rowSpan` rows. `0` = covered cell. Absent ⇒ `1`. Mirrors OOXML
   * `<a:tc rowSpan>` / `<a:tc vMerge>`. The same importer contract
   * applies — `vMerge='1'` translates to `rowSpan: 0` on the covered
   * cell.
   */
  rowSpan?: number;
};

export type TableRow = {
  /**
   * Declared row height in slide-logical pixels. The rendered row
   * height is `max(height, max contentHeight across non-covered cells)`
   * — matching PPTX, where `<a:tr h>` is a *minimum* that content can
   * grow past.
   */
  height: number;
  cells: TableCell[];
};

export type TableElement = ElementBase & {
  type: 'table';
  data: {
    /**
     * Column widths in slide-logical pixels. Authoritative — the
     * rendered table width is `sum(columnWidths)`. Mirrors OOXML
     * `<a:tblGrid>/<a:gridCol w="...">`.
     *
     * **Frame-sync invariant:** `frame.w` always equals
     * `sum(columnWidths)` and `frame.h` equals `sum(row.height for
     * row in rows)` (after row auto-grow). The contract is enforced
     * write-side by `MemSlidesStore.updateElementFrame`, which scales
     * `columnWidths` / `rows[].height` proportionally on every w/h
     * change. Any other code path that mutates `frame.w` / `frame.h`
     * directly (PPTX import builder, future bake operations) MUST
     * preserve the same invariant.
     */
    columnWidths: number[];
    rows: TableRow[];
    /**
     * Optional table-wide style identifier. PPTX-only field; preserved
     * verbatim on import for future PPTX round-trip. v1 does not
     * resolve banded-row / header style rules from this id — per-cell
     * fills/borders are baked at import time.
     */
    tableStyleId?: string;
  };
};

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ConnectorElement
  | GroupElement
  | TableElement;

export type ElementType = Element['type'];

/** Used by Layout placeholders and store.addElement. */
export type ElementInit =
  | Omit<TextElement, 'id'>
  | Omit<ImageElement, 'id'>
  | Omit<ShapeElement, 'id'>
  | Omit<ConnectorElement, 'id'>
  | Omit<GroupElement, 'id'>
  | Omit<TableElement, 'id'>;

/** Generate a short, URL-safe element/slide ID. */
export function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function isElementEmpty(el: Element): boolean {
  if (el.type !== 'text') return false;
  return isBlocksEmpty(el.data.blocks);
}

/**
 * True iff a `Block[]` carries no visible characters — either zero
 * blocks or every inline is the empty string. Shared between the
 * text renderer (placeholder ghost-text branch), the shape renderer
 * (skip text paint when shape's body is empty), and the store
 * (`withShapeText` drops `data.text` again when an edit leaves the
 * body empty so OOXML round-trips don't carry empty `<p:txBody>`).
 */
export function isBlocksEmpty(blocks: Block[]): boolean {
  return (
    blocks.length === 0 ||
    blocks.every((b) => b.inlines.every((inline) => inline.text === ''))
  );
}
