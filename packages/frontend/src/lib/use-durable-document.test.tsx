import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { setDurableLockForTest, type DurableLock } from "./durable-session";
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
