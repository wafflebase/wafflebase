import type { LineToolKind } from "../slides/line-picker-helpers";

/**
 * The board's words for the slides line tools. Google Slides' names
 * ("Scribble", "Elbow connector") describe a presentation tool; a
 * whiteboard user draws with a marker and links stickies with a
 * connector. Line and Arrow are the same word in both.
 */
export const BOARD_LINE_LABELS: Readonly<Partial<Record<LineToolKind, string>>> = {
  "connector:elbow": "Connector",
  "connector:curved": "Curved",
  freeform: "Marker",
};

/** The zero stroke weight of a line: it has no border to remove. */
export const BOARD_LINE_NONE_LABEL = "None";
