import type { Element } from "@wafflebase/slides";
import type { BoardStampKind } from "./types";

/**
 * The board's ritual tools, which take a click on the canvas away from
 * the slides editor:
 *
 * - `stamp`: a click on an element stamps it (or, while a vote is open
 *   and you have not pressed Done, casts a vote on it);
 * - `comment`: the next click drops a comment pin there.
 *
 * Board-local state, like the hand tool (`board-hand.ts`): the slides
 * editor has no notion of either. Exactly one board tool is live at a
 * time — arming one of these disarms the hand and any insert mode, and
 * arming those disarms this (wired in `board-rituals.tsx`).
 */
export type RitualMode = "none" | "stamp" | "comment";

export interface RitualToolState {
  mode: RitualMode;
  stampKind: BoardStampKind;
}

export interface RitualTool {
  get(): RitualToolState;
  setMode(mode: RitualMode): void;
  setStampKind(kind: BoardStampKind): void;
  /**
   * A vote opened: remember the tool in hand, so {@link endVoting} can
   * give it back. Call before arming the stamp for the vote. Idempotent
   * for one session (the local start and the observed start both call it).
   */
  beginVoting(): void;
  /**
   * The vote ended (here or on a peer): if the stamp is still armed, put
   * back the tool from before the vote, normally Select (`"none"`). A tool
   * the user picked during the vote is left alone.
   */
  endVoting(): void;
  subscribe(cb: () => void): () => void;
}

export function createRitualTool(): RitualTool {
  let state: RitualToolState = { mode: "none", stampKind: "plus1" };
  let beforeVoting: RitualMode | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const cb of listeners) cb();
  };
  return {
    get: () => state,
    setMode: (mode) => {
      if (mode === state.mode) return;
      state = { ...state, mode };
      emit();
    },
    setStampKind: (stampKind) => {
      if (stampKind === state.stampKind) return;
      state = { ...state, stampKind };
      emit();
    },
    beginVoting: () => {
      if (beforeVoting === null) beforeVoting = state.mode;
    },
    endVoting: () => {
      const before = beforeVoting;
      beforeVoting = null;
      if (before === null || state.mode !== "stamp") return;
      if (before !== state.mode) {
        state = { ...state, mode: before };
        emit();
      }
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** Plain text of a sticky / shape / text box, for the vote results list. */
export function elementPlainText(el: Element | undefined): string {
  if (!el) return "";
  const data = (el as { data?: unknown }).data as
    | { blocks?: unknown; text?: { blocks?: unknown } }
    | undefined;
  const blocks = (data?.blocks ?? data?.text?.blocks) as
    | Array<{ inlines?: Array<{ text?: string }> }>
    | undefined;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b) => (b.inlines ?? []).map((i) => i.text ?? "").join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
