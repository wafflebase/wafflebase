import { useEffect, useMemo, useState } from "react";
import type { SlidesDocument } from "@wafflebase/slides";
import type { BoardVoting } from "./types";
import { tallyVotes, type TallyRow } from "./voting";

interface ElementSource {
  read(): SlidesDocument;
  onChange(cb: () => void): () => void;
}

function liveIdsKey(store: ElementSource | null): string {
  const elements = store?.read().slides[0]?.elements ?? [];
  return elements.map((e) => e.id).join("\n");
}

/**
 * The ended session's results, counted over the elements that still exist.
 *
 * The element ids are React state, not a ref read at render: a client that
 * attaches after the vote ended receives `voting` before the board's
 * elements, and a tally memoized on `voting` alone would stay at "No votes
 * were cast" forever. The id list is compared as a string, so a drag (which
 * changes frames, not ids) does not re-render.
 */
export function useVotingTally(
  voting: BoardVoting | null,
  store: ElementSource | null,
): TallyRow[] {
  const [idsKey, setIdsKey] = useState(() => liveIdsKey(store));
  useEffect(() => {
    if (!store) return;
    const sync = () => setIdsKey(liveIdsKey(store));
    sync();
    return store.onChange(sync);
  }, [store]);
  return useMemo(
    () =>
      voting?.status === "ended"
        ? tallyVotes(voting, new Set(idsKey ? idsKey.split("\n") : []))
        : [],
    [voting, idsKey],
  );
}
