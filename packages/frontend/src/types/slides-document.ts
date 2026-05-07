import type { Block } from '@wafflebase/docs';

/**
 * Yorkie document root for the slides editor. Phase 4a stores text
 * element bodies as plain `blocks: Block[]` (JSON); Phase 5 will
 * migrate text bodies to Yorkie.Tree alongside the docs IME bridge.
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

export interface YorkieLayout {
  id: string;
  name: string;
  placeholders: Omit<YorkieElement, 'id'>[];
}
