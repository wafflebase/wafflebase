import type { Doc } from '../model/document.js';
import type { InlineStyle } from '../model/types.js';

type Anchor = { blockId: string; offset: number };

export interface PendingStyle {
  get(): Partial<InlineStyle> | null;
  has(): boolean;
  set(style: Partial<InlineStyle>, anchor: Anchor): void;
  clear(): void;
  consumeForInsert(blockId: string, fromOffset: number, toOffset: number): void;
  rewindAnchor(blockId: string, n: number): void;
  rebindAnchor(blockId: string): void;
}

export function createPendingStyle(doc: Doc): PendingStyle {
  let state: { style: Partial<InlineStyle>; anchor: Anchor } | null = null;

  return {
    get: () => (state ? state.style : null),
    has: () => state !== null,
    set: (style, anchor) => {
      state = { style: { ...style }, anchor: { ...anchor } };
    },
    clear: () => {
      state = null;
    },
    consumeForInsert: (blockId, fromOffset, toOffset) => {
      if (!state) return;
      if (state.anchor.blockId !== blockId || state.anchor.offset !== fromOffset) {
        state = null;
        return;
      }
      doc.applyInlineStyle(
        {
          anchor: { blockId, offset: fromOffset },
          focus: { blockId, offset: toOffset },
        },
        state.style,
      );
      state.anchor = { blockId, offset: toOffset };
    },
    rewindAnchor: (blockId, n) => {
      if (!state || state.anchor.blockId !== blockId) return;
      state.anchor.offset = Math.max(0, state.anchor.offset - n);
    },
    rebindAnchor: (blockId) => {
      if (!state) return;
      state.anchor = { blockId, offset: 0 };
    },
  };
}
