import type { Tree } from '@yorkie-js/sdk';
import type { Block } from '@wafflebase/docs';

/**
 * Yorkie document root for the slides editor. Phase 5a stores text
 * element bodies and speaker notes as `Yorkie.Tree` (matching the
 * docs editor's CRDT shape), so character-level edits can converge
 * across peers without last-write-wins on the whole `blocks` array.
 *
 * `read()` still returns `Block[]` snapshots — only the underlying
 * Yorkie storage changed.
 *
 * NOTE: Migrating to Tree breaks the wire format. Documents created
 * before Phase 5a stored these fields as plain `Block[]` JSON; they
 * must be deleted / recreated on the server.
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
  notes: Tree;
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
  data: { tree: Tree };
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

/**
 * Layout placeholders are templates — they describe the initial shape
 * of a text/image/shape element when a slide is added with that layout.
 * They store text bodies as plain `Block[]` (NOT `Tree`) because Tree
 * CRDTs must be created via `new Tree(...)` inside `doc.update`, which
 * is not possible inside a static `BUILT_IN_LAYOUTS` constant or the
 * cloned JSON we put into `r.layouts`. The Tree gets materialised when
 * `addSlide` instantiates the placeholder into an actual element.
 */
export type YorkiePlaceholder =
  | {
      type: 'text';
      frame: YorkieFrame;
      data: { blocks: Block[] };
    }
  | Omit<YorkieImageElement, 'id'>
  | Omit<YorkieShapeElement, 'id'>;

export interface YorkieLayout {
  id: string;
  name: string;
  placeholders: YorkiePlaceholder[];
}
