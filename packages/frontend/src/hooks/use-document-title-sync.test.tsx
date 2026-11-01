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

vi.mock("@yorkie-js/react", () => ({
  createDocumentSelector:
    () =>
    <T,>(selector: (s: { doc: unknown }) => T) =>
      selector({ doc: currentDoc }),
}));

import { useDocumentTitleSync } from "./use-document-title-sync";

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
      (fn: (root: unknown, p: { set: (v: Record<string, unknown>) => void }) => void) =>
        fn({}, { set: (v) => written.push(v) }),
    ),
  };
}

function setup(doc: ReturnType<typeof fakeDoc>) {
  currentDoc = doc;
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDocumentTitleSync("doc-1"), { wrapper });
  return { hook, invalidate };
}

function invalidatedKeys(invalidate: ReturnType<typeof vi.spyOn>) {
  return invalidate.mock.calls.map(
    (call) => (call[0] as { queryKey: unknown[] }).queryKey,
  );
}

describe("useDocumentTitleSync", () => {
  beforeEach(() => {
    currentDoc = undefined;
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
        value: { clientID: "peer", presence: { titleRev: "r1", cursor: [1, 2] } },
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

  it("announces a rename by writing a fresh titleRev to presence", () => {
    const doc = fakeDoc();
    const { hook } = setup(doc);

    act(() => hook.result.current());
    act(() => hook.result.current());

    expect(doc.written).toHaveLength(2);
    const [a, b] = doc.written.map((p) => p.titleRev);
    expect(typeof a).toBe("string");
    expect(a).not.toBe(b);
  });
});
