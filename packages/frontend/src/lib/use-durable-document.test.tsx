import { describe, it, expect, afterEach, vi } from "vitest";
import { render, renderHook, waitFor, act } from "@testing-library/react";
import {
  setDurableLockForTest,
  resetElectionsForTest,
  type DurableLock,
} from "./durable-session";
import { setOfflinePersistenceEnabled } from "./offline-persistence-preference";
import { useDurableDocument } from "./use-durable-document";

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
  it("becomes durable without a reload", async () => {
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.durable).toBe(false);

    act(() => setOfflinePersistenceEnabled(true));

    await waitFor(() => expect(result.current.durable).toBe(true));
  });

  it("gives the election back when it is switched off", async () => {
    // Otherwise the tab keeps a name it no longer uses, and a second tab that
    // could now be durable stays refused.
    const locks = fakeLocks();
    setDurableLockForTest(locks);
    setOfflinePersistenceEnabled(true);

    const { result } = renderHook(() =>
      useDurableDocument({ docKey: "note-7", userId: "u1" }),
    );
    await waitFor(() => expect(result.current.durable).toBe(true));

    act(() => setOfflinePersistenceEnabled(false));

    await waitFor(() => expect(result.current.durable).toBe(false));
    expect(locks.held.size).toBe(0);
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
