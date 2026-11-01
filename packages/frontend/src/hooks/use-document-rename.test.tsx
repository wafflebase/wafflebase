import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

/**
 * A fake document exposing only what the hook touches: the `others` stream,
 * the current peers, and `update` for the local presence write.
 */
type PeerPresence = { clientID: string; presence: Record<string, unknown> };
type OthersEvent =
  | { type: string; value: PeerPresence }
  | { type: "initialized"; value: PeerPresence[] };

let currentDoc: ReturnType<typeof fakeDoc> | undefined;
const renameDocument = vi.fn(async () => undefined);

vi.mock("@yorkie-js/react", () => ({
  createDocumentSelector:
    () =>
    <T,>(selector: (s: { doc: unknown }) => T) =>
      selector({ doc: currentDoc }),
}));

vi.mock("@/api/documents", () => ({
  renameDocument: (...args: unknown[]) => renameDocument(...(args as [])),
}));

import {
  TITLE_REFETCH_COOLDOWN_MS,
  useDocumentRename,
} from "./use-document-rename";

function fakeDoc(others: PeerPresence[] = []) {
  let listener: ((e: OthersEvent) => void) | undefined;
  const written: Record<string, unknown>[] = [];
  let status = "attached";
  return {
    written,
    /** What `DocumentProvider`'s unmount cleanup does to the real document. */
    detach: () => {
      status = "detached";
    },
    getStatus: () => status,
    emit: (e: OthersEvent) => listener?.(e),
    getOthersPresences: () => others,
    getChangeID: () => ({ getActorID: () => "me" }),
    subscribe: vi.fn((type: string, next: (e: OthersEvent) => void) => {
      expect(type).toBe("presence");
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
    update: vi.fn(
      (
        fn: (
          root: unknown,
          p: { set: (v: Record<string, unknown>) => void },
        ) => void,
      ) => fn({}, { set: (v) => written.push(v) }),
    ),
  };
}

function setup(doc: ReturnType<typeof fakeDoc> | undefined) {
  currentDoc = doc;
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDocumentRename("doc-1"), { wrapper });
  return { hook, invalidate };
}

/** The presence writes that tell peers the rename landed. */
function confirmations(doc: ReturnType<typeof fakeDoc>) {
  return doc.written.filter((p) => "titleRev" in p);
}

/** The ones written before the request, in case this client is about to go. */
function headsUps(doc: ReturnType<typeof fakeDoc>) {
  return doc.written.filter((p) => "titleRevPending" in p);
}

function invalidatedKeys(
  invalidate: MockInstance<QueryClient["invalidateQueries"]>,
) {
  return invalidate.mock.calls.map(
    (call) => (call[0] as { queryKey: unknown[] }).queryKey,
  );
}

describe("useDocumentRename", () => {
  beforeEach(() => {
    currentDoc = undefined;
    renameDocument.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches the title when a peer announces a rename", () => {
    const doc = fakeDoc();
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "presence-changed",
        value: { clientID: "peer", presence: { titleRev: "r1" } },
      }),
    );

    expect(invalidatedKeys(invalidate)).toEqual([
      ["document", "doc-1"],
      ["documents"],
    ]);
  });

  it("ignores presence changes that leave titleRev alone", () => {
    const doc = fakeDoc([{ clientID: "peer", presence: { cursor: [0, 0] } }]);
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "watched",
        value: { clientID: "joiner", presence: { username: "j" } },
      }),
    );
    act(() =>
      doc.emit({
        type: "presence-changed",
        value: { clientID: "peer", presence: { cursor: [1, 2] } },
      }),
    );

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refetches once for a titleRev already present at attach", () => {
    vi.useFakeTimers();
    const doc = fakeDoc([{ clientID: "peer", presence: { titleRev: "r1" } }]);
    const { invalidate } = setup(doc);
    expect(invalidatedKeys(invalidate)).toContainEqual(["document", "doc-1"]);
    invalidate.mockClear();

    act(() => {
      vi.advanceTimersByTime(TITLE_REFETCH_COOLDOWN_MS);
      doc.emit({
        type: "presence-changed",
        value: { clientID: "peer", presence: { titleRev: "r1", cursor: [1, 2] } },
      });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refetches for a rename delivered by watched after a reconnect", () => {
    const doc = fakeDoc([{ clientID: "peer", presence: {} }]);
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "watched",
        value: { clientID: "peer", presence: { titleRev: "while-away" } },
      }),
    );

    expect(invalidatedKeys(invalidate)).toContainEqual(["document", "doc-1"]);
  });

  it("coalesces a flood of titleRev changes into one refetch per window", () => {
    vi.useFakeTimers();
    const doc = fakeDoc();
    const { invalidate } = setup(doc);
    const titleRefetches = () =>
      invalidatedKeys(invalidate).filter((k) => k[0] === "document").length;

    act(() => {
      for (let i = 0; i < 50; i++) {
        doc.emit({
          type: "presence-changed",
          value: { clientID: "peer", presence: { titleRev: `r${i}` } },
        });
      }
    });
    expect(titleRefetches()).toBe(1);

    act(() => vi.advanceTimersByTime(TITLE_REFETCH_COOLDOWN_MS));
    expect(titleRefetches()).toBe(2);

    act(() => vi.advanceTimersByTime(TITLE_REFETCH_COOLDOWN_MS * 5));
    expect(titleRefetches()).toBe(2);
  });

  it("renames, refreshes its own cache, and announces a fresh titleRev", async () => {
    const doc = fakeDoc();
    const { hook, invalidate } = setup(doc);

    await act(() => hook.result.current("First"));
    await act(() => hook.result.current("Second"));

    expect(renameDocument.mock.calls).toEqual([
      ["doc-1", "First"],
      ["doc-1", "Second"],
    ]);
    expect(invalidatedKeys(invalidate)).toContainEqual(["document", "doc-1"]);
    const [a, b] = confirmations(doc).map((p) => p.titleRev);
    expect(typeof a).toBe("string");
    expect(a).not.toBe(b);
  });

  it("does not confirm a rename when the request fails", async () => {
    const doc = fakeDoc();
    const { hook } = setup(doc);
    renameDocument.mockRejectedValueOnce(new Error("403"));

    await expect(
      act(() => hook.result.current("Nope")),
    ).rejects.toThrow("403");
    // The heads-up went out before the request, and costs a peer one read of
    // a row that did not change; the confirmation must not.
    expect(confirmations(doc)).toHaveLength(0);
    expect(headsUps(doc)).toHaveLength(1);
  });

  it("still refreshes and resolves when the presence write throws", async () => {
    const doc = fakeDoc();
    doc.update.mockImplementation(() => {
      throw new Error("detached");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { hook, invalidate } = setup(doc);

    await act(() => hook.result.current("Title"));

    expect(invalidatedKeys(invalidate)).toContainEqual(["document", "doc-1"]);
    warn.mockRestore();
  });

  it("announces a rename made before attach once the document arrives", async () => {
    const { hook } = setup(undefined);

    await act(() => hook.result.current("Early"));

    const doc = fakeDoc();
    currentDoc = doc;
    hook.rerender();

    expect(doc.written).toHaveLength(1);
    expect(typeof doc.written[0].titleRev).toBe("string");
  });

  it("announces a rename whose request outlived the attach", async () => {
    let resolveRename: () => void = () => {};
    renameDocument.mockImplementationOnce(
      () => new Promise<undefined>((r) => (resolveRename = () => r(undefined))),
    );
    const { hook } = setup(undefined);
    const handler = hook.result.current;

    let pending!: Promise<void>;
    act(() => {
      pending = handler("Racing");
    });
    const doc = fakeDoc();
    currentDoc = doc;
    hook.rerender();
    expect(doc.written).toHaveLength(0);

    await act(async () => {
      resolveRename();
      await pending;
    });
    expect(doc.written).toHaveLength(1);
  });

  // Committing the title input by clicking a nav link blurs it and navigates
  // in the same gesture, so the PATCH routinely resolves after this hook — and
  // the `DocumentProvider` that detaches the document — is gone. Peers must
  // still be told, or they keep the stale title; the heads-up written before
  // the request is the only write that can reach them.
  it("warns peers before a rename whose request outlives the unmount", async () => {
    let resolveRename: () => void = () => {};
    renameDocument.mockImplementationOnce(
      () => new Promise<undefined>((r) => (resolveRename = () => r(undefined))),
    );
    const doc = fakeDoc();
    const { hook } = setup(doc);

    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current("Leaving");
    });
    expect(headsUps(doc)).toHaveLength(1);
    expect(typeof headsUps(doc)[0].titleRevPending).toBe("string");

    hook.unmount();
    doc.detach();

    await act(async () => {
      resolveRename();
      await pending;
    });
    // Nothing is written to the detached document: the change would never
    // sync, and fabricating presence on it is the case every other presence
    // write in this app guards against.
    expect(doc.written).toHaveLength(1);
  });

  it("reads the row when a peer's rename is only ever a heads-up", () => {
    vi.useFakeTimers();
    const doc = fakeDoc();
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "presence-changed",
        value: { clientID: "peer", presence: { titleRevPending: "p1" } },
      }),
    );
    // Not immediately: the peer's PATCH has not had time to land, and reading
    // now would return the title it is replacing.
    expect(invalidate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(TITLE_REFETCH_COOLDOWN_MS));
    expect(invalidatedKeys(invalidate)).toContainEqual(["document", "doc-1"]);
  });

  it("reads the row at once when the heads-up is confirmed", () => {
    vi.useFakeTimers();
    const doc = fakeDoc();
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "presence-changed",
        value: { clientID: "peer", presence: { titleRevPending: "p1" } },
      }),
    );
    act(() =>
      doc.emit({
        type: "presence-changed",
        value: {
          clientID: "peer",
          presence: { titleRevPending: "p1", titleRev: "r1" },
        },
      }),
    );
    expect(invalidatedKeys(invalidate)).toContainEqual(["document", "doc-1"]);

    // And the verification pass the heads-up scheduled is dropped rather than
    // costing a second read of a row already re-read.
    const reads = () =>
      invalidatedKeys(invalidate).filter((k) => k[0] === "document").length;
    expect(reads()).toBe(1);
    act(() => vi.advanceTimersByTime(TITLE_REFETCH_COOLDOWN_MS * 3));
    expect(reads()).toBe(1);
  });

  it("refetches for a titleRev delivered by the watch initialization", () => {
    const doc = fakeDoc();
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "initialized",
        value: [
          { clientID: "me", presence: { titleRev: "mine" } },
          { clientID: "peer", presence: { username: "p" } },
        ],
      }),
    );
    expect(invalidate).not.toHaveBeenCalled();

    act(() =>
      doc.emit({
        type: "initialized",
        value: [{ clientID: "peer", presence: { titleRev: "renamed" } }],
      }),
    );
    expect(invalidatedKeys(invalidate)).toContainEqual(["document", "doc-1"]);
  });

  it("ignores its own presence changes", () => {
    const doc = fakeDoc();
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "presence-changed",
        value: { clientID: "me", presence: { titleRev: "mine" } },
      }),
    );

    expect(invalidate).not.toHaveBeenCalled();
  });
});
