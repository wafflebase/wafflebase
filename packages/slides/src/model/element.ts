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

export type TextElement = ElementBase & {
  type: 'text';
  data: {
    /** Domain-level read view; the Yorkie store backs this with a Tree. */
    blocks: Block[];
    stroke?: Stroke;
    fill?: ThemeColor;
    /**
     * Autofit behavior. Absent ⇒ 'none' so documents created before this
     * field keep their current fixed-size rendering (no migration).
     */
    autofit?: AutofitMode;
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

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ConnectorElement
  | GroupElement;

export type ElementType = Element['type'];

/** Used by Layout placeholders and store.addElement. */
export type ElementInit =
  | Omit<TextElement, 'id'>
  | Omit<ImageElement, 'id'>
  | Omit<ShapeElement, 'id'>
  | Omit<ConnectorElement, 'id'>
  | Omit<GroupElement, 'id'>;

/** Generate a short, URL-safe element/slide ID. */
export function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function isElementEmpty(el: Element): boolean {
  if (el.type !== 'text') return false;
  return el.data.blocks.every((b) =>
    b.inlines.every((inline) => inline.text === ''),
  );
}
