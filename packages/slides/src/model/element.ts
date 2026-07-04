import type { Block } from '@wafflebase/docs';
import type { ArrowheadPair, ConnectorElement } from './connector';
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

export type AnimCategory = 'entrance' | 'exit' | 'emphasis';
export type AnimStart = 'onClick' | 'withPrev' | 'afterPrev';
export type AnimEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
export type AnimDirection = 'up' | 'down' | 'left' | 'right';

export type AnimEffect =
  | 'appear' | 'fadeIn' | 'flyIn' | 'zoomIn' | 'spin'   // entrance
  | 'disappear' | 'fadeOut' | 'flyOut' | 'zoomOut'      // exit
  | 'pulse' | 'grow';                                   // emphasis

/** One object-animation effect attached to an element on a slide. */
export type ObjectAnimation = {
  id: string;
  category: AnimCategory;
  effect: AnimEffect;
  start: AnimStart;
  direction?: AnimDirection;          // fly effects
  durationMs: number;
  delayMs?: number;
  easing?: AnimEasing;                // absent ⇒ easeInOut
  byParagraph?: boolean;              // text elements only
  /** PPTX round-trip preservation; present ⇒ effect may be preview-only. */
  pptxPreset?: { class: string; id: number; subtype?: number };
  /** Normalized <p:animMotion> path. Preserved on import; not played in v1. */
  motionPath?: string;
};

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
  // Banners (5 P3-B T5 + 2 waves + 2 curved ribbons P3.5)
  | 'ribbon' | 'ribbon2' | 'horizontalScroll' | 'verticalScroll'
  | 'leftRightRibbon'
  | 'wave' | 'doubleWave'
  | 'ellipseRibbon' | 'ellipseRibbon2'
  // Callouts (4 P1 + 3 line callouts + 7 arrow callouts)
  | 'wedgeRectCallout' | 'wedgeRoundRectCallout'
  | 'wedgeEllipseCallout' | 'cloudCallout'
  | 'borderCallout1' | 'borderCallout2' | 'borderCallout3'
  | 'rightArrowCallout' | 'leftArrowCallout'
  | 'upArrowCallout' | 'downArrowCallout'
  | 'leftRightArrowCallout' | 'upDownArrowCallout' | 'quadArrowCallout'
  // Brackets / braces (4 + 2 pairs P3.5) — open-path, stroke-oriented
  | 'leftBracket' | 'rightBracket' | 'leftBrace' | 'rightBrace'
  | 'bracketPair' | 'bracePair'
  // Equation (6)
  | 'mathPlus' | 'mathMinus' | 'mathMultiply'
  | 'mathDivide' | 'mathEqual' | 'mathNotEqual'
  // Stars (6 P2 + 4 high-point + 2 explosions P3.5)
  | 'star4' | 'star5' | 'star6' | 'star7' | 'star8' | 'star10'
  | 'star12' | 'star16' | 'star24' | 'star32'
  | 'irregularSeal1' | 'irregularSeal2'
  // Flowchart (14 P2 + 10 P3.5)
  | 'flowChartTerminator' | 'flowChartPredefinedProcess'
  | 'flowChartInternalStorage' | 'flowChartDocument'
  | 'flowChartMultidocument' | 'flowChartManualInput'
  | 'flowChartManualOperation' | 'flowChartOffpageConnector'
  | 'flowChartPunchedCard' | 'flowChartPunchedTape'
  | 'flowChartSummingJunction' | 'flowChartOr'
  | 'flowChartDelay' | 'flowChartDisplay'
  | 'flowChartPreparation' | 'flowChartConnector'
  | 'flowChartCollate' | 'flowChartSort'
  | 'flowChartExtract' | 'flowChartMerge'
  | 'flowChartOnlineStorage' | 'flowChartMagneticDisk'
  | 'flowChartMagneticDrum' | 'flowChartMagneticTape'
  // Action buttons (12 — P3-B T7) — special-cased renderer
  // (drawActionButton); not entered in PATH_BUILDERS.
  | 'actionButtonBlank' | 'actionButtonBackPrevious'
  | 'actionButtonForwardNext' | 'actionButtonBeginning'
  | 'actionButtonEnd' | 'actionButtonHome'
  | 'actionButtonInformation' | 'actionButtonReturn'
  | 'actionButtonMovie' | 'actionButtonSound'
  | 'actionButtonDocument' | 'actionButtonHelp'
  // Freeform — arbitrary vector path imported from OOXML `<a:custGeom>`.
  // Unlike every other kind it has no parametric `PathBuilder`; its
  // geometry lives in `ShapeElement.data.path` (see {@link FreeformPath}).
  | 'freeform';

/**
 * One command of a {@link FreeformPath}, mirroring an OOXML
 * `<a:custGeom>/<a:path>` segment. All coordinates are **normalized to
 * `[0, 1]`** of the path's own viewBox (the `<a:path w h>` extents) so the
 * renderer can scale a single stored path to any frame size, exactly the
 * way parametric builders scale to `FrameSize`.
 *
 * - `M` moveTo · `L` lineTo · `Q` quadratic Bézier · `C` cubic Bézier
 * - `A` elliptical arc (`<a:arcTo>` reduced to a centre-parametrised arc:
 *   centre `cx,cy`, radii `rx,ry`, `start`/`sweep` in radians)
 * - `Z` closePath
 */
export type FreeformCommand =
  | { c: 'M'; x: number; y: number }
  | { c: 'L'; x: number; y: number }
  | { c: 'Q'; x1: number; y1: number; x: number; y: number }
  | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: 'A'; cx: number; cy: number; rx: number; ry: number; start: number; sweep: number }
  | { c: 'Z' };

/** Normalized vector geometry backing a `'freeform'` ShapeElement. */
export type FreeformPath = {
  commands: FreeformCommand[];
};

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

/**
 * Outer drop shadow. Mirrors OOXML `<a:effectLst><a:outerShdw>`. Absent
 * ⇒ no shadow. Applied at paint time via `ctx.shadow*` around the
 * element's geometry pass.
 */
export type DropShadow = {
  /** Shadow color; resolved against the theme like fills/strokes. */
  color: ThemeColor | string;
  /** Opacity `[0, 1]` ↔ `<a:outerShdw><a:srgbClr><a:alpha>`. */
  opacity: number;
  /** Direction in radians ↔ `<a:outerShdw dir>` (OOXML 60000ths/deg). */
  angle: number;
  /** Offset distance in slide-logical px ↔ `<a:outerShdw dist>` (EMU). */
  distance: number;
  /** Gaussian blur radius in px ↔ `<a:outerShdw blurRad>` (EMU). */
  blur: number;
};

/**
 * Mirror reflection below the element. Mirrors OOXML `<a:reflection>`.
 * Absent ⇒ no reflection. Painted as a vertically-flipped copy with a
 * top-down alpha gradient.
 */
export type Reflection = {
  /** Start alpha `[0, 1]` at the top of the reflection ↔ `stA`. */
  opacity: number;
  /** Gap between element bottom and reflection top, in px ↔ `dist`. */
  distance: number;
  /** Reflection length as a fraction `[0, 1]` of frame height ↔ `endPos`. */
  size: number;
};

/**
 * Paint-time effects shared by shape / image / text / table / group
 * elements. Each field optional; absent ⇒ that effect is off. Grouping
 * them in one bag lets the renderer apply every effect from a single
 * `element.data.effects` read and keeps the per-element `data` schema
 * additive (no migration — older documents simply lack the key).
 */
export type Effects = {
  shadow?: DropShadow;
  reflection?: Reflection;
};

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

/** Per-side text insets, in deck-canvas px (left/top/right/bottom). */
export type TextInset = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

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
  /**
   * Per-side text insets in deck-canvas px, mirroring OOXML
   * `<a:bodyPr lIns/tIns/rIns/bIns>`. When present the renderer uses these
   * instead of its per-kind default padding — decks that set large symmetric
   * insets (e.g. Google-Slides number-in-circle labels) rely on them to
   * center a single glyph. **Absent ⇒ renderer default** (0 for text
   * elements, `SHAPE_TEXT_PADDING` for shapes), preserving prior behavior.
   */
  inset?: TextInset;
};

export type TextElement = ElementBase & {
  type: 'text';
  data: TextBody & {
    stroke?: Stroke;
    fill?: ThemeColor;
    /** Paint-time effects (drop shadow / reflection). See {@link Effects}. */
    effects?: Effects;
    /** Screen-reader description ↔ `<p:cNvPr descr>`. Absent ⇒ none. */
    alt?: string;
  };
};

/**
 * Preset recolor applied to an image via `ctx.filter`. Mirrors the
 * common Google Slides Recolor presets. `'duotone'` (theme-tinted) is a
 * follow-up — it needs offscreen color compositing, not a CSS filter.
 * Absent / `'none'` ⇒ original colors.
 */
export type ImageRecolor = 'none' | 'grayscale' | 'sepia';

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
    /** Preset recolor filter ↔ `<a:duotone>` / `<a:grayscl>`. */
    recolor?: ImageRecolor;
    /**
     * Brightness adjustment, range `[-1, 1]` (0 = unchanged). Applied as
     * `ctx.filter = brightness(1 + value)`. Mirrors OOXML `<a:lum bright>`.
     */
    brightness?: number;
    /**
     * Contrast adjustment, range `[-1, 1]` (0 = unchanged). Applied as
     * `ctx.filter = contrast(1 + value)`. Mirrors OOXML `<a:lum contrast>`.
     */
    contrast?: number;
    /** Paint-time effects (drop shadow / reflection). See {@link Effects}. */
    effects?: Effects;
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
    /**
     * Vector geometry for `kind === 'freeform'` shapes (OOXML
     * `<a:custGeom>`). Absent for every parametric kind, which derives
     * its path from `kind` + `adjustments` via a `PathBuilder`. Stored
     * normalized to `[0, 1]` so it scales with the frame. See
     * {@link FreeformPath}.
     */
    path?: FreeformPath;
    fill?: ThemeColor;
    stroke?: Stroke;
    /**
     * Line-end arrowheads for an open `kind === 'freeform'` path, mirroring
     * OOXML `<a:ln><a:headEnd>/<a:tailEnd>`. `start` decorates the path's
     * first anchor, `end` the last. Only meaningful on stroked open
     * freeforms (PowerPoint exports arrowed curves as `<p:sp>` custGeom, not
     * `<p:cxnSp>`); parametric kinds ignore it. Shares the connector
     * {@link ArrowheadPair} model and renderer.
     */
    arrowheads?: ArrowheadPair;
    /**
     * Inline text body painted on top of the shape's fill/stroke.
     * Absent on freshly-inserted shapes; lazily initialised when the
     * user enters text-edit (double-click, Enter, or type-to-edit) and
     * dropped again on commit when the body ends up empty. Mirrors
     * OOXML `<p:sp>/<p:txBody>` for PPTX round-trip.
     */
    text?: TextBody;
    /** Paint-time effects (drop shadow / reflection). See {@link Effects}. */
    effects?: Effects;
    /** Screen-reader description ↔ `<p:cNvPr descr>`. Absent ⇒ none. */
    alt?: string;
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
    /**
     * Paint-time effects applied to the group as a whole (drop shadow).
     * See {@link Effects}.
     */
    effects?: Effects;
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

/**
 * Default cell border applied to every side of every cell when the
 * editor inserts a fresh table — without it the cells are invisible
 * until the user types or applies a fill, which makes a brand-new
 * table look like an empty rectangle. Tailwind `gray-300` at 1 px is
 * subtle enough to read as "table grid" without competing with the
 * authored content; users can override via the cell-border presets
 * ("All", "Outer", "Clear") or per-side picks once we ship the full
 * TableControls toolbar.
 *
 * Imported PPTX tables retain whatever borders they came with
 * (including the `<a:alpha val="0"/>` "invisible-by-design" idiom);
 * this constant only seeds the in-editor insert path.
 */
export const DEFAULT_CELL_BORDER: CellBorder = {
  color: '#D1D5DB',
  width: 1,
};

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
    /** Paint-time effects (drop shadow). See {@link Effects}. */
    effects?: Effects;
    /** Screen-reader description ↔ `<p:cNvPr descr>`. Absent ⇒ none. */
    alt?: string;
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
