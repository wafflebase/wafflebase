import { describe, expect, it } from "vitest";
import { chatShortcut, modalSurfaceOpen } from "@/app/chat/chat-shortcuts";

const key = (init: KeyboardEventInit & { keyCode?: number }) => {
  const e = new KeyboardEvent("keydown", { cancelable: true, ...init });
  if (init.keyCode !== undefined) {
    Object.defineProperty(e, "keyCode", { value: init.keyCode });
  }
  return e;
};

describe("chatShortcut", () => {
  it("maps Alt+arrows to channel moves, with Shift for unread", () => {
    expect(chatShortcut(key({ key: "ArrowUp", altKey: true }))).toBe("prev");
    expect(chatShortcut(key({ key: "ArrowDown", altKey: true }))).toBe("next");
    expect(
      chatShortcut(key({ key: "ArrowUp", altKey: true, shiftKey: true })),
    ).toBe("prev-unread");
    expect(
      chatShortcut(key({ key: "ArrowDown", altKey: true, shiftKey: true })),
    ).toBe("next-unread");
  });

  it("maps Mod+K to the switcher, by code so any layout works", () => {
    expect(chatShortcut(key({ key: "k", metaKey: true }))).toBe("switcher");
    expect(chatShortcut(key({ key: "k", ctrlKey: true }))).toBe("switcher");
    expect(
      chatShortcut(key({ key: "ㅏ", code: "KeyK", metaKey: true })),
    ).toBe("switcher");
  });

  it("ignores near misses", () => {
    expect(chatShortcut(key({ key: "ArrowUp" }))).toBeNull();
    expect(
      chatShortcut(key({ key: "ArrowUp", altKey: true, metaKey: true })),
    ).toBeNull();
    expect(chatShortcut(key({ key: "ArrowLeft", altKey: true }))).toBeNull();
    expect(
      chatShortcut(key({ key: "k", metaKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      chatShortcut(key({ key: "k", metaKey: true, altKey: true })),
    ).toBeNull();
  });

  it("leaves a key something else already handled", () => {
    const e = key({ key: "ArrowUp", altKey: true });
    e.preventDefault();
    expect(chatShortcut(e)).toBeNull();
  });

  it("leaves an IME composition alone", () => {
    expect(
      chatShortcut(key({ key: "k", metaKey: true, isComposing: true })),
    ).toBeNull();
    expect(
      chatShortcut(key({ key: "Process", altKey: true, keyCode: 229 })),
    ).toBeNull();
  });
});

describe("modalSurfaceOpen", () => {
  it.each(["dialog", "alertdialog", "menu", "listbox"])(
    "is true while a %s is in the DOM",
    (role) => {
      const doc = document.implementation.createHTMLDocument("t");
      expect(modalSurfaceOpen(doc)).toBe(false);
      const el = doc.createElement("div");
      el.setAttribute("role", role);
      doc.body.append(el);
      expect(modalSurfaceOpen(doc)).toBe(true);
    },
  );
});
