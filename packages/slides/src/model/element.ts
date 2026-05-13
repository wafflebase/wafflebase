import type { Block } from '@wafflebase/docs';
import type { ThemeColor } from './theme';

export type Frame = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation around the element center, in radians. */
  rotation: number;
};

export type ImageRef = {
  src: string;
  /** Natural pixel dimensions, used to constrain crop and aspect. */
  w: number;
  h: number;
};

/** Crop rectangle in image-relative coordinates (0..1 on each axis). */
export type Crop = { x: number; y: number; w: number; h: number };

export type ShapeKind =
  // Lines (special-cased renderers in shape-special.ts)
  | 'line' | 'arrow'
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
  // Block arrows (8)
  | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow'
  | 'leftRightArrow' | 'quadArrow' | 'chevron' | 'pentagonArrow'
  // Callouts (4)
  | 'wedgeRectCallout' | 'wedgeRoundRectCallout'
  | 'wedgeEllipseCallout' | 'cloudCallout'
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
  | 'flowChartDelay' | 'flowChartDisplay';

export type ShapeStroke = {
  color: ThemeColor;
  width: number;
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
  };
};

export type ImageElement = ElementBase & {
  type: 'image';
  data: {
    src: string;
    crop?: Crop;
    alt?: string;
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
    stroke?: ShapeStroke;
  };
};

export type Element = TextElement | ImageElement | ShapeElement;

export type ElementType = Element['type'];

/** Used by Layout placeholders and store.addElement. */
export type ElementInit =
  | Omit<TextElement, 'id'>
  | Omit<ImageElement, 'id'>
  | Omit<ShapeElement, 'id'>;

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
