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
type OthersEvent = {
  type: string;
  value: { clientID: string; presence: Record<string, unknown> };
};

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

function fakeDoc(others: OthersEvent["value"][] = []) {
  let listener: ((e: OthersEvent) => void) | undefined;
  const written: Record<string, unknown>[] = [];
  return {
    written,
    emit: (e: OthersEvent) => listener?.(e),
    getOthersPresences: () => others,
    subscribe: vi.fn((type: string, next: (e: OthersEvent) => void) => {
      expect(type).toBe("others");
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
    const [a, b] = doc.written.map((p) => p.titleRev);
    expect(typeof a).toBe("string");
    expect(a).not.toBe(b);
  });

  it("does not announce when the rename request fails", async () => {
    const doc = fakeDoc();
    const { hook } = setup(doc);
    renameDocument.mockRejectedValueOnce(new Error("403"));

    await expect(
      act(() => hook.result.current("Nope")),
    ).rejects.toThrow("403");
    expect(doc.written).toHaveLength(0);
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
});
