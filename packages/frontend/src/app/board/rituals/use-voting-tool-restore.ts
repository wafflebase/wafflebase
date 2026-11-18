import { useEffect, useRef } from "react";
import type { RitualTool } from "./ritual-tool";
import type { BoardVoting } from "./types";

/**
 * Give the tool back when a vote ends. Starting a vote arms the stamp
 * (the voting tool); without this it stays armed after "End voting", or
 * after a peer ends the vote, and the next click stamps instead of
 * selecting. Watches the session's open/closed transitions, so a remote
 * end is handled the same as a local one.
 */
export function useVotingToolRestore(
  voting: BoardVoting | null,
  tool: RitualTool | null,
): void {
  const open = voting?.status === "active";
  const sessionId = open ? voting.id : null;
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!tool) return;
    const was = prev.current;
    prev.current = sessionId;
    if (was === sessionId) return;
    if (was !== null) tool.endVoting();
    if (sessionId !== null) tool.beginVoting();
  }, [sessionId, tool]);
}
