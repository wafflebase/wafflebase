import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, renderHook, waitFor, act } from "@testing-library/react";
import {
  setDurableLockForTest,
  resetElectionsForTest,
  type DurableLock,
} from "./durable-session";
import { setOfflinePersistenceEnabled } from "./offline-persistence-preference";
import { useDurableDocument } from "./use-durable-document";
import * as capabilities from "./yorkie-capabilities";

/**
 * The policy that decides whether a document is persisted locally.
 *
 * Every arm of it is a refusal, and each refusal exists because the durable
 * path is *worse* than the non-durable one when its precondition is missing —
 * not merely unavailable.
 */

function fakeLocks(): DurableLock & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async request(name) {
      if (held.has(name)) return undefined;
      held.add(name);
      return () => held.delete(name);
    },
  };
}

beforeEach(() => {
  // These cases are about the policy, not about which version this repo is
  // pinned to. The pin has its own test, and one case below closes this gate
  // on purpose.
  vi.spyOn(capabilities, "supportsClientKey").mockReturnValue(true);
});

afterEach(() => {
  setDurableLockForTest(undefined);
  resetElectionsForTest();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("when it elects the tab", () => {
  it("is durable, with a key scoped to user and document", async () => {
    setDurableLockForTest(fakeLocks());
    setOfflinePersistenceEnabled(true);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );

    await waitFor(() => expect(result.current.durable).toBe(true));
    expect(result.current.clientKey).toBe("wb:u1:note-7");
  });

  it("releases the election when the view unmounts", async () => {
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const { result, unmount } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(result.current.durable).toBe(true));

    unmount();
    await waitFor(() => expect(locks.held.size).toBe(0));
  });
});

describe("when it refuses", () => {
  it("refuses while the preference is off", async () => {
    // The default. Persisting writes document content to this device's disk,
    // so it is opted into, never assumed.
    setDurableLockForTest(fakeLocks());

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.durable).toBe(false);
    expect(result.current.clientKey).toBeUndefined();
  });

  it("takes no lock at all while the preference is off", async () => {
    // Holding the name without using it would deny durability to a second tab
    // that could have had it.
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(locks.held.size).toBe(0);
  });

  it("refuses the second tab on the same document", async () => {
    // First-tab-wins. The second tab keeps today's random key and no store:
    // a stable key in both tabs means one shared actor, colliding clientSeqs,
    // and each tab's changes filtered out of the other — silent edit loss.
    setDurableLockForTest(fakeLocks());
    setOfflinePersistenceEnabled(true);

    const first = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(first.result.current.durable).toBe(true));

    // A different tab shares the lock manager and remembers none of this one's
    // elections. Within *one* tab a second caller deliberately shares — that is
    // what keeps React's double-invoked effects from refusing themselves.
    resetElectionsForTest();
    const second = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(second.result.current.settled).toBe(true));
    expect(second.result.current.durable).toBe(false);
  });

  it("refuses a PDF comment document", async () => {
    // PDF documents ride the same provider seam but have no sync chip. Durable
    // without a way to report it breaks the invariant the chip depends on:
    // whatever is durable must be reportable.
    setDurableLockForTest(fakeLocks());
    setOfflinePersistenceEnabled(true);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "pdf-123", userId: "u1" }),
    );

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.durable).toBe(false);
  });

  it("refuses when there is no signed-in user", async () => {
    // An anonymous share-link visitor. Their key would not be theirs to scope,
    // and the entry would be unattributable at logout.
    setDurableLockForTest(fakeLocks());
    setOfflinePersistenceEnabled(true);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: undefined }),
    );

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.durable).toBe(false);
  });
});

describe("when the preference changes mid-session", () => {
  it("takes no election it will never use when it is switched on", async () => {
    // The consumer latches its decision when the document mounts, so a rise
    // here buys nothing and costs two things: the per-document lock is held for
    // a client that is never mounted — denying durability to every other tab —
    // and the subject moves, which un-settles the hook and makes a consumer
    // that waits for `settled` unmount the editor and its change queue with it.
    //
    // The preference governs the next document opened, which is what the chip's
    // own offer and the Settings copy both say.
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.durable).toBe(false);

    act(() => setOfflinePersistenceEnabled(true));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.durable).toBe(false);
    expect(result.current.settled).toBe(true);
    expect(locks.held.size).toBe(0);
  });

  it("is durable for the next document opened after it", async () => {
    // The other half of the same rule: the preference is not ignored, it
    // applies where changing it is free.
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const { result, rerender } = renderHook(
      (props: { docKey: string }) =>
        useDurableDocument({ docKey: props.docKey, userId: "u1" }),
      { initialProps: { docKey: "note-7" } },
    );
    await waitFor(() => expect(result.current.settled).toBe(true));

    act(() => setOfflinePersistenceEnabled(true));
    rerender({ docKey: "note-8" });

    await waitFor(() => expect(result.current.durable).toBe(true));
  });

  it("keeps the election it already holds when it is switched off", async () => {
    // The consumer latches its decision for the life of the open document —
    // unmounting the provider under unsent edits is the loss this feature
    // exists to prevent — so a client mounted on this election is still
    // writing. Releasing the name underneath it would let a second tab take
    // the same name and mint the same client key: one actor, two tabs, each
    // one's changes filtered out of the other.
    //
    // The preference still governs the next document opened, and the erase
    // that accompanies switching it off is what removes what was stored.
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(result.current.durable).toBe(true));

    act(() => setOfflinePersistenceEnabled(false));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.durable).toBe(true);
    expect(locks.held.size).toBe(1);
  });

  it("releases it once the document is closed", async () => {
    // The hold is for the open document, not forever: the next tab to open it
    // must be able to be the durable one.
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const { result, unmount } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(result.current.durable).toBe(true));

    act(() => setOfflinePersistenceEnabled(false));
    unmount();

    await waitFor(() => expect(locks.held.size).toBe(0));
  });
});

describe("moving between documents", () => {
  it("releases the old document's election and takes the new one's", async () => {
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const { result, rerender } = renderHook(
      (props: { docKey: string }) =>
        useDurableDocument({ docKey: props.docKey, userId: "u1" }),
      { initialProps: { docKey: "note-7" } },
    );
    await waitFor(() => expect(result.current.clientKey).toBe("wb:u1:note-7"));

    rerender({ docKey: "note-8" });
    await waitFor(() => expect(result.current.clientKey).toBe("wb:u1:note-8"));

    // Exactly one name held, and it is the new one: a leaked election on the
    // old document would refuse durability to whoever opens it next.
    expect(Array.from(locks.held)).toEqual(["wb-durable:u1:note-8"]);
  });
});

describe("what it says on the way between answers", () => {
  it("never reports a key it does not hold the election for", async () => {
    // The failure this whole module exists to prevent, and it lives in a
    // single transient render: the state is one render behind the props, so
    // reporting from the state alone answers the new document's question with
    // the old document's election — a fully `settled` clientKey nobody elected
    // this tab to use. A consumer mounts a Yorkie client on exactly that
    // signal, so one wrong render is enough to put two tabs on one actor.
    //
    // Recorded per render rather than read at the end, because the steady
    // state is correct either way; only the renders between answers are not.
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const seen: Array<{ clientKey?: string; held: Array<string> }> = [];
    function Probe({ docKey }: { docKey: string }) {
      const state = useDurableDocument({ docKey, userId: "u1" });
      seen.push({
        clientKey: state.clientKey,
        held: Array.from(locks.held),
      });
      return null;
    }

    const { rerender } = render(<Probe docKey="note-7" />);
    await waitFor(() => expect(seen.at(-1)!.clientKey).toBe("wb:u1:note-7"));

    rerender(<Probe docKey="note-8" />);
    await waitFor(() => expect(seen.at(-1)!.clientKey).toBe("wb:u1:note-8"));

    // A key may only be claimed while the matching name is actually held.
    for (const render of seen) {
      if (!render.clientKey) continue;
      const docKey = render.clientKey.split(":").pop();
      expect(render.held).toContain(`wb-durable:u1:${docKey}`);
    }
  });

  it("is unsettled while a changed identity is being decided", async () => {
    // `settled` exists so a consumer does not mount the non-durable client and
    // tear it down a moment later. Left true across a change, it would say the
    // new question is answered when only the old one was.
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const { result, rerender } = renderHook(
      (props: { userId: string }) =>
        useDurableDocument({ docKey: "note-7", userId: props.userId }),
      { initialProps: { userId: "u1" } },
    );
    await waitFor(() => expect(result.current.durable).toBe(true));

    rerender({ userId: "u2" });
    // Synchronously after the change, before any effect has run.
    expect(result.current.settled).toBe(false);
    expect(result.current.durable).toBe(false);
    expect(result.current.clientKey).toBeUndefined();

    await waitFor(() => expect(result.current.clientKey).toBe("wb:u2:note-7"));
  });
});

describe("on a build that cannot carry a client key", () => {
  it("refuses, and takes no lock", async () => {
    // The store is keyed `apiKey/clientKey/docKey`, so without a key of our own
    // the SDK mints one at random per session: every page load writes to a
    // fresh scope and resumes nothing. Going durable there would fill the
    // store with unusable entries and let the chip claim a durability that
    // does not survive a reload.
    vi.spyOn(capabilities, "supportsClientKey").mockReturnValue(false);
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.durable).toBe(false);
    expect(result.current.clientKey).toBeUndefined();
    expect(locks.held.size).toBe(0);
  });
});

describe("answering without waiting", () => {
  it("is settled on the very first render when the feature is off", async () => {
    // The caller renders nothing until this says settled, so an answer that
    // needs an effect puts a blank frame in front of every editor — for a
    // feature that is switched off, which is every document today. There is
    // nothing to wait for here: no election is attempted.
    //
    // Recorded per render because `render()` is wrapped in `act()`, which
    // flushes effects before returning: by the time a query runs, the frame
    // has already been replaced.
    setDurableLockForTest(fakeLocks());

    const seen: Array<boolean> = [];
    function Probe() {
      const { settled } = useDurableDocument({
        docKey: "note-7",
        userId: "u1",
      });
      seen.push(settled);
      return null;
    }

    render(<Probe />);
    expect(seen[0]).toBe(true);
  });

  it("is unsettled on the first render when an election is attempted", async () => {
    // The other half: when there *is* something to wait for, saying settled
    // early would have the caller mount the ambient client and swap.
    setDurableLockForTest(fakeLocks());
    setOfflinePersistenceEnabled(true);

    const seen: Array<boolean> = [];
    function Probe() {
      const { settled } = useDurableDocument({
        docKey: "note-7",
        userId: "u1",
      });
      seen.push(settled);
      return null;
    }

    render(<Probe />);
    expect(seen[0]).toBe(false);
    await waitFor(() => expect(seen.at(-1)).toBe(true));
  });
});

describe("giving up the election", () => {
  it("frees the name so another tab can be durable", async () => {
    // The race the app lock cannot settle alone: this tab is elected, and the
    // SDK's own lock refuses the attach anyway. Holding on then is strictly
    // worse than losing — this tab is not durable and nobody else can be.
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(result.current.durable).toBe(true));

    act(() => result.current.standDown());

    await waitFor(() => expect(result.current.durable).toBe(false));
    // Still settled: the caller asked to stop, so leaving it undecided would
    // have them mount nothing at all.
    expect(result.current.settled).toBe(true);
    expect(locks.held.size).toBe(0);
  });

  it("is harmless when there was no election to give up", async () => {
    setDurableLockForTest(fakeLocks());

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(result.current.settled).toBe(true));

    expect(() => act(() => result.current.standDown())).not.toThrow();
    expect(result.current.durable).toBe(false);
  });
});

describe("when eligibility is lost", () => {
  it("never reports the old election under the new document's key", async () => {
    // Navigating from a durable note to a PDF. The PDF is the one exclusion
    // the design calls structural — durable without a chip to report it breaks
    // the invariant the chip depends on — and the state is a render behind, so
    // an answer taken from it alone hands the *new* key the *old* session.
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const seen: Array<{ docKey: string; durable: boolean; key?: string }> = [];
    function Probe({ docKey }: { docKey: string }) {
      const state = useDurableDocument({ docKey, userId: "u1" });
      seen.push({
        docKey,
        durable: state.durable,
        key: state.clientKey,
      });
      return null;
    }

    const { rerender } = render(<Probe docKey="note-7" />);
    await waitFor(() => expect(seen.at(-1)!.durable).toBe(true));

    rerender(<Probe docKey="pdf-9" />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    for (const render of seen) {
      if (render.docKey.startsWith("pdf-")) {
        expect(render.durable).toBe(false);
        expect(render.key).toBeUndefined();
      }
    }
  });

  it("never reports durable after the preference is switched off for a new document", async () => {
    // The document already open keeps its election (see above). A document
    // opened after the switch must not inherit it — the answer and the name
    // have to agree, in both directions.
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const seen: Array<{ docKey: string; durable: boolean }> = [];
    function Probe({ docKey }: { docKey: string }) {
      const { durable } = useDurableDocument({ docKey, userId: "u1" });
      seen.push({ docKey, durable });
      return null;
    }

    const { rerender } = render(<Probe docKey="note-7" />);
    await waitFor(() => expect(seen.at(-1)!.durable).toBe(true));

    act(() => setOfflinePersistenceEnabled(false));
    rerender(<Probe docKey="note-8" />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Not one render of the newly opened document may claim durability.
    expect(
      seen.filter((s) => s.docKey === "note-8").some((s) => s.durable),
    ).toBe(false);
  });
});
