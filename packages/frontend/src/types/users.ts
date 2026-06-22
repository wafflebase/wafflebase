import type { Sref, SelectionPresence } from "@wafflebase/sheets";

export type User = {
  id: number;
  authProvider: string;
  username: string;
  email: string;
  photo: string;
};

export type UserPresence = {
  selection?: SelectionPresence;
  activeCell?: Sref; // legacy fallback for mixed-version peers
  activeTabId?: string;
} & User;

export type DocsPresence = {
  username: string;
  email: string;
  photo: string;
  activeCursorPos?: {
    blockId: string;
    offset: number;
  };
  activeSelection?: {
    anchor: { blockId: string; offset: number };
    focus: { blockId: string; offset: number };
    tableCellRange?: {
      blockId: string;
      start: { rowIndex: number; colIndex: number };
      end: { rowIndex: number; colIndex: number };
    };
  };
};

export type SlidesPresence = {
  username: string;
  email: string;
  photo: string;
  /** id of the slide the user is currently viewing/editing. */
  activeSlideId?: string;
  /** ids of elements the user has selected on activeSlideId. */
  selectedElementIds?: string[];
  /** during an active drag/resize/rotate, the live frame for visual
   * peer feedback. Cleared on mouseup. */
  activeFrames?: Array<{
    elementId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  }>;
  /**
   * Live preview of a guide being created from the ruler or an
   * existing guide being dragged. `id` is absent when the user is
   * creating a new guide; present when an existing guide is moving.
   * Cleared on mouseup. See docs/design/slides/slides-ruler.md.
   */
  draggingGuide?: {
    id?: string;
    axis: 'x' | 'y';
    position: number;
  };
  /**
   * Cell range the user has selected inside a table (the table analogue
   * of `selectedElementIds`). `elementId` is the table; `r0/c0`–`r1/c1`
   * are the inclusive anchor/focus cell coords. Cleared by broadcasting
   * `undefined` when the cell selection ends — consumers guard on
   * presence, so a deleted-or-undefined key reads the same. Peer text
   * carets inside a cell (`textCursorCell`) and live edge-resize preview
   * (`resizingTableEdge`) are deferred with the live-presence work.
   */
  selectedTableCells?: {
    elementId: string;
    r0: number;
    c0: number;
    r1: number;
    c1: number;
  };
};
