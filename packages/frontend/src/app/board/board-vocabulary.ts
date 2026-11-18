import type { LineToolKind } from "../slides/line-picker-helpers";

/**
 * The board's words for the slides line tools. Google Slides' names
 * ("Scribble", "Elbow connector") describe a presentation tool; a
 * whiteboard user links stickies with a connector. Line and Arrow are the
 * same word in both.
 */
export const BOARD_LINE_LABELS: Readonly<Partial<Record<LineToolKind, string>>> = {
  "connector:elbow": "Connector",
  "connector:curved": "Curved",
};

/**
 * Line-picker entries the board leaves out: Scribble, because the board's
 * dedicated Marker tool (M) is the one way to draw freehand there.
 */
export const BOARD_LINE_EXCLUDE: readonly LineToolKind[] = ["freeform"];

/** The zero stroke weight of a line: it has no border to remove. */
export const BOARD_LINE_NONE_LABEL = "None";
