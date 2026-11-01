import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { useDocumentRename } from "./use-document-title-sync";

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

function invalidatedKeys(invalidate: ReturnType<typeof vi.spyOn>) {
  return invalidate.mock.calls.map(
    (call) => (call[0] as { queryKey: unknown[] }).queryKey,
  );
}

describe("useDocumentRename", () => {
  beforeEach(() => {
    currentDoc = undefined;
    renameDocument.mockClear();
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
    const doc = fakeDoc([{ clientID: "peer", presence: { titleRev: "r1" } }]);
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "presence-changed",
        value: {
          clientID: "peer",
          presence: { titleRev: "r1", cursor: [1, 2] },
        },
      }),
    );
    act(() =>
      doc.emit({
        type: "presence-changed",
        value: { clientID: "other", presence: { cursor: [3, 4] } },
      }),
    );

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("treats a joining peer's titleRev as already-known", () => {
    const doc = fakeDoc();
    const { invalidate } = setup(doc);

    act(() =>
      doc.emit({
        type: "watched",
        value: { clientID: "late", presence: { titleRev: "old" } },
      }),
    );
    act(() =>
      doc.emit({
        type: "presence-changed",
        value: { clientID: "late", presence: { titleRev: "old" } },
      }),
    );
    expect(invalidate).not.toHaveBeenCalled();

    act(() =>
      doc.emit({
        type: "presence-changed",
        value: { clientID: "late", presence: { titleRev: "new" } },
      }),
    );
    expect(invalidate).toHaveBeenCalled();
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
});
