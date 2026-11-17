import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "@wafflebase/board";
import type { BoardPresence } from "@/types/board-document";
import { attachBoardPresence, presenceKeyAction } from "./board-presence";

function fakeDoc(others: { clientID: string; presence: Partial<BoardPresence> }[] = []) {
  const listeners = new Set<() => void>();
  return {
    others,
    getOthersPresences: () => others,
    getMyPresence: () => ({ username: "me" }),
    subscribe: (_: "others", cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit: () => listeners.forEach((l) => l()),
  };
}

const editor = (selection: string[] = []) => ({
  isTextEditing: () => false,
  isCropping: () => false,
  getSelection: () => selection,
});

function setup(opts: { readOnly?: boolean; others?: { clientID: string; presence: Partial<BoardPresence> }[] } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const doc = fakeDoc(opts.others);
  const updatePresence = vi.fn();
  let vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
  const minimap = { setPeers: vi.fn() };
  const ctl = attachBoardPresence({
    container,
    doc,
    store: { updatePresence },
    readOnly: opts.readOnly === true,
    editor: editor(),
    getViewport: () => vp,
    getHost: () => ({ w: 800, h: 600 }),
    getCanvasRect: () => ({ left: 0, top: 0 }),
    commitViewport: (next) => {
      vp = next;
      ctl.onViewportCommitted();
    },
    isBoardTarget: () => true,
    theme: "light",
    minimap,
  });
  return { container, doc, updatePresence, ctl, minimap, getVp: () => vp };
}

const move = (el: HTMLElement, x: number, y: number) =>
  el.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
const key = (k: string) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("presenceKeyAction", () => {
  const base = {
    key: "/", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    repeat: false, target: document.body, defaultPrevented: false,
  };
  const ctx = { readOnly: false, isBoardTarget: () => true, editor: editor() };
  it("maps / to chat and E to emotes with nothing selected", () => {
    expect(presenceKeyAction(base, ctx)).toBe("chat");
    expect(presenceKeyAction({ ...base, key: "e" }, ctx)).toBe("emote");
  });
  it("stands down for a selection (type-to-edit wins), read-only, and modifiers", () => {
    expect(presenceKeyAction(base, { ...ctx, editor: editor(["a"]) })).toBeNull();
    expect(presenceKeyAction(base, { ...ctx, readOnly: true })).toBeNull();
    expect(presenceKeyAction({ ...base, metaKey: true }, ctx)).toBeNull();
    expect(presenceKeyAction({ ...base, key: "E", shiftKey: true }, ctx)).toBeNull();
  });
  it("ignores keys aimed at a field", () => {
    const input = document.createElement("input");
    expect(presenceKeyAction({ ...base, target: input }, ctx)).toBeNull();
  });
});

describe("attachBoardPresence", () => {
  it("never writes presence on a read-only mount", () => {
    const { container, updatePresence, ctl } = setup({
      readOnly: true,
      others: [{ clientID: "p", presence: { username: "Ada" } }],
    });
    move(container, 10, 10);
    key("/");
    key("e");
    ctl.setSpotlight(true);
    vi.advanceTimersByTime(1000);
    expect(updatePresence).not.toHaveBeenCalled();
    ctl.dispose();
  });

  it("publishes nothing continuous while alone, and catches up when a peer arrives", () => {
    const { container, doc, updatePresence, ctl } = setup();
    move(container, 10, 10);
    vi.advanceTimersByTime(1000);
    expect(updatePresence).not.toHaveBeenCalled();
    doc.others.push({ clientID: "p", presence: { username: "Ada" } });
    doc.emit();
    vi.advanceTimersByTime(1);
    const fields = updatePresence.mock.calls.map((c) => Object.keys(c[0])[0]);
    expect(fields).toContain("cursor");
    expect(fields).toContain("viewport");
    ctl.dispose();
  });

  it("does not re-send when a commit leaves the pointer's world position unchanged", () => {
    const peers = [{ clientID: "p", presence: { username: "Ada" } }];
    const { container, updatePresence, ctl } = setup({ others: peers });
    move(container, 100, 100);
    vi.advanceTimersByTime(500);
    updatePresence.mockClear();
    ctl.onViewportCommitted();
    vi.advanceTimersByTime(500);
    expect(updatePresence.mock.calls.some((c) => "cursor" in c[0])).toBe(false);
    ctl.dispose();
  });

  it("moves the published cursor when the board pans under it", () => {
    const peers = [{ clientID: "p", presence: { username: "Ada" } }];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const updatePresence = vi.fn();
    let vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    const ctl = attachBoardPresence({
      container,
      doc: fakeDoc(peers),
      store: { updatePresence },
      readOnly: false,
      editor: editor(),
      getViewport: () => vp,
      getHost: () => ({ w: 800, h: 600 }),
      getCanvasRect: () => ({ left: 0, top: 0 }),
      commitViewport: () => undefined,
      isBoardTarget: () => true,
      theme: "light",
    });
    move(container, 100, 100);
    vi.advanceTimersByTime(500);
    vp = { panX: -50, panY: 0, zoom: 1 };
    ctl.onViewportCommitted();
    vi.advanceTimersByTime(500);
    const cursors = updatePresence.mock.calls.filter((c) => "cursor" in c[0]).map((c) => c[0].cursor);
    expect(cursors.at(-1)).toEqual({ x: 150, y: 100 });
    ctl.dispose();
  });

  it("opens cursor chat on / and sends what is typed", () => {
    const { container, updatePresence, ctl } = setup({
      others: [{ clientID: "p", presence: { username: "Ada" } }],
    });
    key("/");
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Cursor chat"]')!;
    expect(document.activeElement).toBe(input);
    input.value = "hi";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    expect(updatePresence).toHaveBeenCalledWith({ chat: "hi" });
    // Fades after 4 s of no edits.
    vi.advanceTimersByTime(4100);
    expect(updatePresence).toHaveBeenLastCalledWith({ chat: null });
    ctl.dispose();
  });

  it("sends an emote burst from the E picker", () => {
    const { container, updatePresence, ctl } = setup({
      others: [{ clientID: "p", presence: { username: "Ada" } }],
    });
    key("e");
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.getAttribute("aria-label") === "Send 🎉")!
      .click();
    const emote = updatePresence.mock.calls.find((c) => "emote" in c[0])?.[0].emote;
    expect(emote).toMatchObject({ emoji: "🎉" });
    key("Escape");
    expect(container.querySelector<HTMLElement>("[data-board-emote-picker]")!.style.display).toBe("none");
    ctl.dispose();
  });

  it("auto-follows a spotlighting peer and stops on Esc", () => {
    const others = [
      { clientID: "p", presence: { username: "Ada", viewport: { x: 500, y: 500, zoom: 2 } } as Partial<BoardPresence> },
    ];
    const { container, doc, ctl } = setup({ others });
    others[0].presence = { ...others[0].presence, spotlight: 123 };
    doc.emit();
    expect(container.textContent).toContain("Ada is spotlighting");
    key("Escape");
    expect(container.querySelector<HTMLElement>('[role="status"]')!.style.display).toBe("none");
    // Dismissed: the same spotlight does not grab the view again.
    doc.emit();
    expect(container.querySelector<HTMLElement>('[role="status"]')!.style.display).toBe("none");
    ctl.dispose();
  });

  it("follows a peer from the header and offers a hint only when it can", () => {
    const others = [
      { clientID: "p", presence: { username: "Ada", viewport: { x: 1, y: 2, zoom: 1 } } as Partial<BoardPresence> },
      { clientID: "q", presence: { username: "Bob" } as Partial<BoardPresence> },
    ];
    const { container, ctl } = setup({ others });
    expect(ctl.jumpHint("p")).toBeDefined();
    expect(ctl.jumpHint("q")).toBeUndefined();
    ctl.selectPeer("p");
    expect(container.textContent).toContain("Following Ada");
    ctl.dispose();
  });

  it("writes spotlight once per toggle and paints peers on the minimap", () => {
    const { updatePresence, ctl, minimap } = setup({
      others: [{ clientID: "p", presence: { username: "Ada", cursor: { x: 5, y: 6 } } }],
    });
    ctl.setSpotlight(true);
    ctl.setSpotlight(true);
    expect(updatePresence.mock.calls.filter((c) => "spotlight" in c[0])).toHaveLength(1);
    expect(ctl.isSpotlighting()).toBe(true);
    expect(minimap.setPeers).toHaveBeenLastCalledWith([
      expect.objectContaining({ x: 5, y: 6 }),
    ]);
    ctl.dispose();
  });
});
