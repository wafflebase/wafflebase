import type { Block } from '@wafflebase/docs';

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
 */
export interface YorkieSlidesRoot {
  meta: { title: string };
  slides: YorkieSlide[];
  layouts: YorkieLayout[];
}

export interface YorkieSlide {
  id: string;
  layoutId: string;
  background: { fill: string; image?: { src: string; w: number; h: number } };
  elements: YorkieElement[];
  notes: Block[];
}

export type YorkieElement =
  | YorkieTextElement
  | YorkieImageElement
  | YorkieShapeElement;

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
  data: { blocks: Block[] };
}

export interface YorkieImageElement {
  id: string;
  type: 'image';
  frame: YorkieFrame;
  data: {
    src: string;
    crop?: { x: number; y: number; w: number; h: number };
    alt?: string;
  };
}

export interface YorkieShapeElement {
  id: string;
  type: 'shape';
  frame: YorkieFrame;
  data: {
    kind: 'rect' | 'ellipse' | 'line' | 'arrow';
    fill?: string;
    stroke?: { color: string; width: number };
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
