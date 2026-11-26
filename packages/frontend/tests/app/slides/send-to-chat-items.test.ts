import { describe, expect, it, vi } from "vitest";

import { sendToChatMenuItems } from "@/app/slides/send-to-chat-items";

const deck = () => ["s1", "s2", "s3"];

function editorOn(slideId: string | null) {
  return { getCurrentSlideId: () => slideId };
}

/** Runs the menu's "Send to chat" entry and returns what it sent. */
function sendFrom(slideId: string | null) {
  const send = vi.fn();
  const items = sendToChatMenuItems(editorOn(slideId), deck, send);
  items.find((item) => item.label === "Send to chat")!.run();
  expect(send).toHaveBeenCalledTimes(1);
  return send.mock.calls[0][0];
}

describe("sendToChatMenuItems", () => {
  // A share-link viewer and a revision preview have no sender, and an editor
  // that has not mounted yet has nothing to anchor at: the menu is unchanged
  // rather than carrying an entry that does nothing.
  it("adds nothing without a sender or an editor", () => {
    expect(sendToChatMenuItems(editorOn("s1"), deck, null)).toEqual([]);
    expect(sendToChatMenuItems(null, deck, vi.fn())).toEqual([]);
  });

  it("ends the menu with a separator and the entry", () => {
    const items = sendToChatMenuItems(editorOn("s1"), deck, vi.fn());
    expect(items.map((item) => item.label)).toEqual(["---", "Send to chat"]);
  });

  it("anchors at the current slide, labelled by its 1-based position", () => {
    expect(sendFrom("s1")).toEqual({ slideId: "s1", label: "Slide 1" });
    expect(sendFrom("s3")).toEqual({ slideId: "s3", label: "Slide 3" });
  });

  // A layout being edited is a slide the deck does not list, so a reader
  // could not be taken to it: the link goes out for the whole document.
  it("sends a document-level link for a slide outside the deck", () => {
    expect(sendFrom("layout-title")).toBeNull();
    expect(sendFrom(null)).toBeNull();
  });

  // The deck is read when the entry runs, not when the menu is built, so a
  // slide added or reordered while the menu is open is labelled correctly.
  it("reads the deck order when the entry runs", () => {
    const order = ["s1", "s2"];
    const send = vi.fn();
    const items = sendToChatMenuItems(editorOn("s2"), () => order, send);
    order.unshift("s0");
    items[1].run();
    expect(send).toHaveBeenCalledWith({ slideId: "s2", label: "Slide 3" });
  });
});
