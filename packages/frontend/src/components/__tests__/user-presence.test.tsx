import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the labelling rule: a presence with no username is not drawn, rather
 * than drawn as "Anonymous".
 *
 * That substitution was the visible half of issue #1004 — when presence failed
 * to initialize, the signed-in user's own avatar was replaced by a lone
 * "Anonymous (You)", reporting a phantom participant when the truth was that
 * presence was empty. It also made the existing `username.length > 0` filter
 * dead code.
 */
const presencesMock = vi.fn();
const useDocumentMock = vi.fn();

vi.mock("@yorkie-js/react", () => ({
  useDocument: () => useDocumentMock(),
  usePresences: () => presencesMock(),
}));

vi.mock("@wafflebase/sheets", () => ({
  getPeerCursorColor: () => "#abcdef",
}));

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import { UserPresence } from "../user-presence";
import { TooltipProvider } from "@/components/ui/tooltip";

/** `others` are the clientIDs the document reports as peers. */
function setup(
  presences: Array<{ clientID: string; presence: Record<string, unknown> }>,
  others: string[] = [],
) {
  presencesMock.mockReturnValue(presences);
  useDocumentMock.mockReturnValue({
    doc: { getOthersPresences: () => others.map((clientID) => ({ clientID })) },
  });
  // Rendered avatars carry a Radix tooltip, which throws without its provider.
  return render(
    <TooltipProvider>
      <UserPresence />
    </TooltipProvider>,
  );
}

describe("UserPresence username labelling", () => {
  beforeEach(() => {
    presencesMock.mockReset();
    useDocumentMock.mockReset();
  });

  it("does not render an entry for an empty presence", () => {
    // Exactly the #1004 state: attached, one presence, no identity in it.
    const { queryByText, container } = setup([
      { clientID: "c1", presence: { selection: [1, 2], cursor: [0, 0] } },
    ]);
    expect(queryByText(/Anonymous/)).toBeNull();
    expect(container.textContent ?? "").not.toContain("AN");
  });

  it("still renders a share-link visitor who is genuinely 'Anonymous'", () => {
    // shared-document.tsx writes the literal string, so this is a real
    // participant and must keep its avatar.
    const { container } = setup([
      { clientID: "c1", presence: { username: "Anonymous", photo: "" } },
    ]);
    expect(container.textContent ?? "").toContain("A");
  });

  it("renders a normal signed-in user", () => {
    const { container } = setup([
      { clientID: "c1", presence: { username: "hackerwins", photo: "" } },
    ]);
    expect(container.textContent ?? "").toContain("H");
  });

  it("drops only the identity-less peer, keeping the real ones", () => {
    const { container } = setup(
      [
        { clientID: "c1", presence: { username: "hackerwins" } },
        { clientID: "c2", presence: {} },
        { clientID: "c3", presence: { username: "bob" } },
      ],
      ["c2", "c3"],
    );
    const text = container.textContent ?? "";
    expect(text).toContain("H");
    expect(text).toContain("B");
    expect(text).not.toContain("Anonymous");
  });

  it("treats a whitespace-only username as absent", () => {
    const { container } = setup([{ clientID: "c1", presence: { username: "   " } }]);
    expect((container.textContent ?? "").trim()).toBe("");
  });
});
