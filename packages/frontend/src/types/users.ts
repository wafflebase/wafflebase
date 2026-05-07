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
};
