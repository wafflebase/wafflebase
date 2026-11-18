import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SlidesDocument } from "@wafflebase/slides";
import type { BoardVoting } from "./types";
import { useVotingTally } from "./use-voting-tally";

function fakeStore() {
  let ids: string[] = [];
  const listeners = new Set<() => void>();
  return {
    read: () =>
      ({ slides: [{ elements: ids.map((id) => ({ id })) }] }) as unknown as SlidesDocument,
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setIds(next: string[]) {
      ids = next;
      for (const cb of listeners) cb();
    },
    listeners,
  };
}

const ended: BoardVoting = {
  id: "v1",
  prompt: "",
  perPerson: 3,
  onlyStickies: false,
  startedBy: "u1",
  startedByName: "A",
  status: "ended",
  ballots: { u1: ["a", "a", "b"], u2: ["a"] },
  done: {},
};

describe("useVotingTally", () => {
  it("recounts when the elements arrive after an ended vote", () => {
    // A late joiner: the session is already ended, the board is still empty.
    const store = fakeStore();
    const { result } = renderHook(() => useVotingTally(ended, store));
    expect(result.current).toEqual([]);

    act(() => store.setIds(["a", "b"]));
    expect(result.current).toEqual([
      { elementId: "a", votes: 3 },
      { elementId: "b", votes: 1 },
    ]);

    // A deleted element drops out of the results.
    act(() => store.setIds(["a"]));
    expect(result.current).toEqual([{ elementId: "a", votes: 3 }]);
  });

  it("is empty while the vote is active, and unsubscribes on unmount", () => {
    const store = fakeStore();
    store.setIds(["a"]);
    const { result, unmount } = renderHook(() =>
      useVotingTally({ ...ended, status: "active" }, store),
    );
    expect(result.current).toEqual([]);
    unmount();
    expect(store.listeners.size).toBe(0);
  });
});
