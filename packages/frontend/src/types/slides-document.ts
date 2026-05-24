import type { Block } from '@wafflebase/docs';
import type {
  ArrowheadStyle,
  ConnectorRouting,
  Endpoint,
  Master,
  PlaceholderRef,
  ShapeKind,
  Theme,
  ThemeColor,
} from '@wafflebase/slides';

/**
 * Yorkie document root for the slides editor. Text element bodies
 * and speaker notes are stored as plain `Block[]` JSON.
 *
 * Phase 5a originally migrated these fields to `yorkie.Tree`, but
 * Yorkie's `Tree` CRDT does NOT register correctly when nested inside
 * an array element (the Tree gets serialized to JSON instead of
 * wrapped as a live CRDT, so subsequent reads see a plain object
 * with no `getRootTreeNode` method, and writes silently no-op). The
 * migration was reverted.
 *
 * Concurrent edits resolve as last-write-wins on commit (blur). Per-
 * keystroke convergence requires a different storage layout — most
 * likely a root-level `textTrees: { [elementId]: Tree }` map keyed
 * by id, which Yorkie can wrap as a CRDT. Tracked as Phase 5a-2.
 *
 * `themes`, `masters`, `meta.themeId`, and `meta.masterId` are
 * optional in this snapshot type because pre-existing Yorkie docs
 * predate the v0.5 theme system. The migration that backfills them
 * lives in Task 3 (yorkie-slides-store).
 */
export interface YorkieSlidesRoot {
  meta: { title: string; themeId?: string; masterId?: string };
  slides: YorkieSlide[];
  layouts: YorkieLayout[];
  themes?: Theme[];
  masters?: Master[];
  /**
   * Presentation-wide alignment guides. Optional in the Yorkie root
   * because pre-v0.4.2 documents predate the ruler; `ensureSlidesRoot`
   * lazy-inits an empty array on attach so consumers never see
   * `undefined`. See docs/design/slides/slides-ruler.md.
   */
  guides?: YorkieGuide[];
}

export interface YorkieGuide {
  id: string;
  axis: 'x' | 'y';
  position: number;
}

export interface YorkieSlide {
  id: string;
  layoutId: string;
  /**
   * Pre-v0.5 documents persisted `background.fill` as a string and may
   * lack the field entirely. Optional here to reflect the raw Yorkie
   * shape; `migrateDocument` (called at read time) wraps any legacy
   * value into a `ThemeColor` so consumers reading through `read()`
   * always see a defined fill.
   */
  background: {
    fill?: ThemeColor;
    image?: {
      src: string;
      opacity?: number;
      crop?: { x: number; y: number; w: number; h: number };
    };
  };
  elements: YorkieElement[];
  notes: Block[];
}

export type YorkieElement =
  | YorkieTextElement
  | YorkieImageElement
  | YorkieShapeElement
  | YorkieConnectorElement
  | YorkieGroupElement;

interface YorkieFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface YorkieTextElement {
  id: string;
  type: 'text';
  frame: YorkieFrame;
  placeholderRef?: PlaceholderRef;
  data: { blocks: Block[] };
}

export interface YorkieImageElement {
  id: string;
  type: 'image';
  frame: YorkieFrame;
  placeholderRef?: PlaceholderRef;
  data: {
    src: string;
    crop?: { x: number; y: number; w: number; h: number };
    alt?: string;
    opacity?: number;
  };
}

export interface YorkieShapeElement {
  id: string;
  type: 'shape';
  frame: YorkieFrame;
  placeholderRef?: PlaceholderRef;
  data: {
    kind: ShapeKind;
    adjustments?: number[];
    fill?: ThemeColor;
    stroke?: { color: ThemeColor; width: number };
  };
}

/**
 * Connector element — line/arrow joining two endpoints. The cached
 * `frame` is derived from the resolved endpoint positions and refreshed
 * on every mutation that could move them (endpoint update, source
 * shape move, source shape delete). Connectors do not appear as layout
 * placeholders, so they are intentionally absent from `YorkiePlaceholder`.
 */
export interface YorkieConnectorElement {
  id: string;
  type: 'connector';
  frame: YorkieFrame;
  routing: ConnectorRouting;
  start: Endpoint;
  end: Endpoint;
  arrowheads: { start?: ArrowheadStyle; end?: ArrowheadStyle };
  stroke?: { color: ThemeColor; width: number };
  elbowBend?: number;
}

/**
 * Group element — contains a `children` array of nested elements stored in
 * group-local coordinates. Groups can be nested arbitrarily; their children
 * are themselves YorkieElements (including other groups).
 */
export interface YorkieGroupElement {
  id: string;
  type: 'group';
  frame: YorkieFrame;
  data: {
    children: YorkieElement[];
    /**
     * Reference dimensions of the group's local coordinate space.
     * See GroupElement.data.refSize for full semantics. Optional for
     * backward compatibility; absent means scale = 1 (prior behavior).
     */
    refSize?: { w: number; h: number };
  };
}

/** Layout placeholder shape — element template without an id. */
export type YorkiePlaceholder =
  | Omit<YorkieTextElement, 'id'>
  | Omit<YorkieImageElement, 'id'>
  | Omit<YorkieShapeElement, 'id'>;

export interface YorkieLayout {
  id: string;
  name: string;
  placeholders: YorkiePlaceholder[];
}
