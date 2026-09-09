import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These pin the repair described in `collab-document-provider.tsx`: after
 * attach, the keys of `initialPresence` that the SDK dropped are re-asserted,
 * and nothing else is touched.
 *
 * The provider is stubbed rather than driven against a real Yorkie client —
 * the defect being compensated for lives in `client.attach`, and reproducing
 * it needs a live server (that lives in the task doc's measurement, not here).
 * What must not regress is this component's *policy*, which is exactly what a
 * fake document can express.
 */
const useDocumentMock = vi.fn();

vi.mock("@yorkie-js/react", () => ({
  DocumentProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useDocument: () => useDocumentMock(),
}));

import { CollabDocumentProvider } from "../collab-document-provider";

type FakeDoc = {
  getStatus: () => string;
  getMyPresence: () => Record<string, unknown>;
  update: ReturnType<typeof vi.fn>;
};

/** A document whose presence is `presence`, recording what gets written. */
function fakeDoc(
  presence: Record<string, unknown> | null,
  status = "attached",
): FakeDoc {
  const update = vi.fn((fn: (root: unknown, p: unknown) => void) =>
    fn({}, { set: (patch: Record<string, unknown>) => patch }),
  );
  return {
    getStatus: () => status,
    getMyPresence: () => presence as Record<string, unknown>,
    update,
  };
}

/** The patch handed to `presence.set(...)`, or undefined if nothing was written. */
function writtenPatch(doc: FakeDoc): Record<string, unknown> | undefined {
  if (doc.update.mock.calls.length === 0) return undefined;
  let captured: Record<string, unknown> | undefined;
  const fn = doc.update.mock.calls[0][0] as (r: unknown, p: unknown) => void;
  fn({}, { set: (patch: Record<string, unknown>) => (captured = patch) });
  return captured;
}

const IDENTITY = {
  username: "hackerwins",
  email: "a@b.c",
  photo: "p.png",
};

function mount(doc: FakeDoc, initialPresence: Record<string, unknown>) {
  useDocumentMock.mockReturnValue({ doc });
  render(
    <CollabDocumentProvider docKey="note-1" initialPresence={initialPresence}>
      <div>child</div>
    </CollabDocumentProvider>,
  );
}

describe("CollabDocumentProvider presence repair", () => {
  beforeEach(() => {
    useDocumentMock.mockReset();
  });

  it("restores initialPresence when attach dropped it entirely", () => {
    // The measured symptom: attached, no error, presence silently empty.
    const doc = fakeDoc({});
    mount(doc, IDENTITY);
    expect(writtenPatch(doc)).toEqual(IDENTITY);
  });

  it("writes nothing when attach honoured initialPresence", () => {
    const doc = fakeDoc({ ...IDENTITY });
    mount(doc, IDENTITY);
    // Not merely "wrote the same values" — no CRDT write at all, so the
    // healthy path costs no change and no sync.
    expect(doc.update).not.toHaveBeenCalled();
  });

  it("never overwrites a key the editor already published", () => {
    // The regression this guards: SlidesView/BoardView broadcast their own
    // presence fields and rely on identity fields being left alone. A repair
    // that re-set every key would clobber a live selection.
    const doc = fakeDoc({ selectedElementIds: ["el-9"], cursor: [12, 34] });
    mount(doc, {
      ...IDENTITY,
      selectedElementIds: [],
      cursor: null,
    });

    const patch = writtenPatch(doc);
    expect(patch).toEqual(IDENTITY);
    expect(patch).not.toHaveProperty("selectedElementIds");
    expect(patch).not.toHaveProperty("cursor");
  });

  it("repairs only the subset of keys that went missing", () => {
    const doc = fakeDoc({ username: "hackerwins" });
    mount(doc, IDENTITY);
    expect(writtenPatch(doc)).toEqual({ email: "a@b.c", photo: "p.png" });
  });

  it("leaves a document that is not attached alone", () => {
    // `getMyPresence()` answers {} for a detached document too. Writing then
    // would fabricate presence rather than restore it.
    const doc = fakeDoc({}, "detached");
    mount(doc, IDENTITY);
    expect(doc.update).not.toHaveBeenCalled();
  });

  it("does nothing before the document exists", () => {
    useDocumentMock.mockReturnValue({ doc: undefined });
    expect(() =>
      render(
        <CollabDocumentProvider docKey="note-1" initialPresence={IDENTITY}>
          <div>child</div>
        </CollabDocumentProvider>,
      ),
    ).not.toThrow();
  });

  it("tolerates a doc-like value that is missing the presence API", () => {
    // Not hypothetical: several existing tests stub `useDocument()` with only
    // the members they need. This effect runs in the provider of every
    // collaborative document, and a throw from a passive effect unmounts the
    // tree — a missing avatar must never become a blank editor.
    useDocumentMock.mockReturnValue({ doc: { getRoot: () => ({}) } });
    expect(() =>
      render(
        <CollabDocumentProvider docKey="note-1" initialPresence={IDENTITY}>
          <div>child</div>
        </CollabDocumentProvider>,
      ),
    ).not.toThrow();
  });

  it("does not propagate a failure from the presence write", () => {
    const doc = fakeDoc({});
    doc.update = vi.fn(() => {
      throw new Error("document is not attached");
    });
    useDocumentMock.mockReturnValue({ doc });
    expect(() =>
      render(
        <CollabDocumentProvider docKey="note-1" initialPresence={IDENTITY}>
          <div>child</div>
        </CollabDocumentProvider>,
      ),
    ).not.toThrow();
  });

  it("renders its children", () => {
    const doc = fakeDoc({ ...IDENTITY });
    useDocumentMock.mockReturnValue({ doc });
    const { getByText } = render(
      <CollabDocumentProvider docKey="note-1" initialPresence={IDENTITY}>
        <div>child</div>
      </CollabDocumentProvider>,
    );
    expect(getByText("child")).toBeTruthy();
  });
});
