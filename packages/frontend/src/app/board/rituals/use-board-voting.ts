import { useMemo } from "react";
import { createDocumentSelector } from "@yorkie-js/react";
import type { BoardPresence, YorkieBoardRoot } from "@/types/board-document";
import type { BoardVoting } from "./types";
import { yorkieJson } from "./yorkie-plain";

const useBoardDocSelector = createDocumentSelector<YorkieBoardRoot, BoardPresence>();

/**
 * The board's voting session as plain data, or `null`.
 *
 * Selects the session's JSON string, so a component re-renders only when
 * the session itself changes — not on every peer cursor move, which a
 * bare `useDocument()` would turn into a commit.
 */
export function useBoardVoting(): BoardVoting | null {
  const json = useBoardDocSelector((s) => yorkieJson(s.root?.voting));
  return useMemo(() => (json ? (JSON.parse(json) as BoardVoting) : null), [json]);
}

/** The attached document handle, which never changes identity. */
export function useBoardDoc() {
  return useBoardDocSelector((s) => s.doc);
}
