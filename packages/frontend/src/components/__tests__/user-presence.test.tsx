import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  props: React.ComponentProps<typeof UserPresence> = {},
) {
  presencesMock.mockReturnValue(presences);
  useDocumentMock.mockReturnValue({
    doc: { getOthersPresences: () => others.map((clientID) => ({ clientID })) },
  });
  // Rendered avatars carry a Radix tooltip, which throws without its provider.
  return render(
    <TooltipProvider>
      <UserPresence {...props} />
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

/**
 * Pins the contract the revision-preview hosts rely on: omitting
 * `onSelectPeer` / `getJumpHint` leaves every peer entry — avatar and overflow
 * menu item alike — unable to jump. `document-detail.tsx` and
 * `docs-detail.tsx` withhold both while a preview is open, and a jump would
 * move the LIVE editor and republish presence under the "Viewing a version"
 * banner.
 */
describe("UserPresence peer jump", () => {
  // Me plus five peers: four avatars are drawn, the last two peers overflow
  // into the "+N" menu, so both jump paths are on screen.
  const presences = [
    { clientID: "me", presence: { username: "me" } },
    ...["p1", "p2", "p3", "p4", "p5"].map((id) => ({
      clientID: id,
      presence: { username: `peer ${id}` },
    })),
  ];
  const others = ["p1", "p2", "p3", "p4", "p5"];

  beforeEach(() => {
    presencesMock.mockReset();
    useDocumentMock.mockReset();
  });

  const peerButtons = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("button")).filter(
      (b) => !b.getAttribute("aria-label")?.includes("more users"),
    );

  it("jumps from an avatar and from the overflow menu when wired", async () => {
    const onSelectPeer = vi.fn();
    const { container } = setup(presences, others, {
      onSelectPeer,
      getJumpHint: () => "A1",
    });
    const buttons = peerButtons(container);
    const enabled = buttons.filter((b) => !b.disabled);
    // Every drawn peer can jump; only my own avatar cannot.
    expect(enabled).toHaveLength(buttons.length - 1);

    const user = userEvent.setup();
    await user.click(enabled[0]);
    expect(onSelectPeer).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /more users/ }));
    const items = await screen.findAllByRole("menuitem");
    await user.click(items[items.length - 1]);
    expect(onSelectPeer).toHaveBeenCalledTimes(2);
  });

  it("offers no jump anywhere when the callbacks are withheld", async () => {
    const onSelectPeer = vi.fn();
    // `getJumpHint` alone, as a host that forgot to withhold it would pass:
    // without `onSelectPeer` nothing may be clickable either.
    for (const props of [{}, { getJumpHint: () => "A1" }]) {
      const { container, unmount } = setup(presences, others, props);
      for (const b of peerButtons(container)) expect(b.disabled).toBe(true);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /more users/ }));
      const items = await screen.findAllByRole("menuitem");
      for (const item of items) {
        expect(item.className).not.toContain("cursor-pointer");
        await user.click(item);
      }
      expect(container.ownerDocument.body.textContent).not.toContain(
        "Click to jump",
      );
      unmount();
    }
    expect(onSelectPeer).not.toHaveBeenCalled();
  });

  it("does not jump when only the hint is withheld", async () => {
    // The hosts withhold both; withholding only the hint must still be enough,
    // since `canJump` requires a hint for the peer.
    const onSelectPeer = vi.fn();
    const { container } = setup(presences, others, { onSelectPeer });
    for (const b of peerButtons(container)) expect(b.disabled).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /more users/ }));
    for (const item of await screen.findAllByRole("menuitem")) {
      await user.click(item);
    }
    expect(onSelectPeer).not.toHaveBeenCalled();
  });
});
