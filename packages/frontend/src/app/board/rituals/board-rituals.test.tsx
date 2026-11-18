import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MutableRefObject, ReactNode } from "react";
import type { Element, SlidesEditor, Viewport } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { YorkieBoardRoot } from "@/types/board-document";
import type { YorkieBoardStore } from "../yorkie-board-store";
import { createHandTool } from "../board-hand";
import type { BoardVoting } from "./types";

// The Yorkie document hooks need a live `DocumentProvider`; the tests feed
// the voting session and the document handle directly instead.
const yorkie = vi.hoisted(() => ({
  voting: null as BoardVoting | null,
  root: {} as Record<string, unknown>,
}));
vi.mock("./use-board-voting", () => ({
  useBoardVoting: () => yorkie.voting,
  useBoardDoc: () => ({ getRoot: () => yorkie.root }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
// The results panel is its own component with its own tests.
vi.mock("./board-voting-panel", () => ({ BoardVotingPanel: () => null }));

import { BoardRituals, type RitualMenus } from "./board-rituals";
import { BoardRitualTools } from "./board-ritual-controls";
import { BoardFacilitateControls } from "../board-facilitate-controls";
import { BoardCollabContext, type BoardCollabValue } from "./board-collab-hook";
import { createRitualTool, type RitualTool } from "./ritual-tool";
import { createVoting } from "./voting";

const STICKY: Element = {
  id: "a",
  type: "shape",
  frame: { x: 0, y: 0, w: 200, h: 200, rotation: 0 },
  data: { kind: "roundRect", role: "sticky" },
} as unknown as Element;

/** A store whose ritual writes land on `yorkie.root`, counting each batch. */
function fakeStore() {
  const store = {
    batches: 0,
    read: () => ({ slides: [{ id: "board", elements: [STICKY] }] }),
    onChange: () => () => undefined,
    readTimer: () => undefined,
    writeTimer: () => undefined,
    batch: (fn: () => void) => {
      store.batches++;
      fn();
    },
    updateRituals: (fn: (root: YorkieBoardRoot) => void) =>
      fn(yorkie.root as unknown as YorkieBoardRoot),
  };
  return store;
}

function fakeEditor(): SlidesEditor {
  return {
    isTextEditing: () => false,
    exitTextEditing: () => undefined,
    getSelection: () => [],
    setSelection: () => undefined,
    setInsertMode: () => undefined,
    getInsertMode: () => null,
    onInsertModeChange: () => () => undefined,
    topLevelElementAt: () => "a",
  } as unknown as SlidesEditor;
}

function collabValue(tool: RitualTool, readOnly: boolean): BoardCollabValue {
  return {
    documentId: "doc",
    readOnly,
    user: { key: "u1", name: "Ada", author: { userId: "1", username: "Ada" } },
    members: [],
    tool,
    threads: [],
    liveIds: new Set(["a"]),
    panelOpen: false,
    setPanelOpen: () => undefined,
    activeThreadId: null,
    setActiveThreadId: () => undefined,
    pending: null,
    setPending: () => undefined,
    addThread: async () => null,
    addReply: async () => undefined,
    setResolved: async () => undefined,
    editComment: async () => undefined,
    deleteComment: async () => undefined,
    focusAnchorRef: { current: null },
    openThread: () => undefined,
  };
}

/** Mount the toolbar block and the canvas layer as `BoardView` does. */
function mount(readOnly: boolean) {
  const tool = createRitualTool();
  const store = fakeStore();
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");
  container.append(canvas, document.createElement("div"));
  document.body.appendChild(container);
  const menuRef: MutableRefObject<RitualMenus | null> = { current: null };
  const vpRef: MutableRefObject<Viewport> = { current: { panX: 0, panY: 0, zoom: 1 } };
  const collab = collabValue(tool, readOnly);
  const ui = (): ReactNode => (
    <TooltipProvider>
      <BoardCollabContext.Provider value={collab}>
        <BoardRitualTools store={store as unknown as YorkieBoardStore} />
        <BoardFacilitateControls
          store={store as unknown as YorkieBoardStore}
          editor={fakeEditor()}
          presence={null}
          laser={null}
        />
        <BoardRituals
          editor={fakeEditor()}
          store={store as unknown as YorkieBoardStore}
          hand={createHandTool()}
          containerRef={{ current: container }}
          vpRef={vpRef}
          readOnly={readOnly}
          menuRef={menuRef}
          navigateRef={{ current: null }}
        />
      </BoardCollabContext.Provider>
    </TooltipProvider>
  );
  const view = render(<>{ui()}</>);
  const click = () => fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100 });
  return { tool, store, canvas, menuRef, click, rerender: () => view.rerender(<>{ui()}</>) };
}

beforeEach(() => {
  yorkie.voting = null;
  yorkie.root = { stamps: {} };
});

afterEach(() => {
  // Unmount first: wiping the body under a mounted tree leaves React (and
  // any open Radix portal) removing nodes that are already gone.
  cleanup();
  document.body.innerHTML = "";
});

describe("BoardRituals on a read-only mount", () => {
  it("offers no stamp, vote or comment tool and no comment menu entry", () => {
    const { menuRef } = mount(true);
    expect(screen.queryByRole("button", { name: /stamp|vot|comment/i })).toBeNull();
    expect(menuRef.current?.canvasItems({ x: 0, y: 0 })).toEqual([]);
    expect(menuRef.current?.elementItems({ x: 0, y: 0 })).toEqual([]);
  });

  it("writes nothing on a canvas click even with the stamp tool armed", () => {
    const { tool, store, click } = mount(true);
    act(() => tool.setMode("stamp"));
    click();
    expect(store.batches).toBe(0);
    expect(yorkie.root.stamps).toEqual({});
  });
});

describe("BoardRitualTools stamp button", () => {
  it("shows a monochrome glyph while idle and the coloured sticker once armed", () => {
    const { tool } = mount(false);
    const stamp = screen.getByRole("button", { name: "Stamp" });
    // Idle: no second chromatic signal in the dock (the One Accent Rule).
    expect(stamp.querySelector("[data-stamp-glyph]")?.getAttribute("stroke")).toBe("currentColor");
    expect(stamp.querySelector("[data-stamp-badge]")).toBeNull();
    act(() => tool.setMode("stamp"));
    expect(stamp.querySelector("[data-stamp-badge]")).toBeTruthy();
    expect(stamp.querySelector("[data-stamp-glyph]")).toBeNull();
  });

  it("builds its chevron from the dock's shared split-tool primitive", () => {
    mount(false);
    // The primitive's tooltip is asserted in board-tool-dock.test.tsx.
    const chevron = screen.getByRole("button", { name: "Stamps" });
    expect(chevron.hasAttribute("data-split-chevron")).toBe(true);
  });
});

describe("BoardRituals on an editable mount", () => {
  it("stamps the clicked element in one batch", async () => {
    const { store, click } = mount(false);
    await userEvent.click(screen.getByRole("button", { name: "Stamp" }));
    click();
    expect(store.batches).toBe(1);
    const stamps = Object.values(yorkie.root.stamps as Record<string, { el: string; by: string }>);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({ el: "a", by: "u1", kind: "plus1" });
  });

  it("starting a vote arms the vote tool, and a click casts a ballot instead of a stamp", async () => {
    const { tool, store, click, rerender } = mount(false);
    await userEvent.click(screen.getByRole("button", { name: "Start voting" }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(tool.get().mode).toBe("stamp");
    const started = yorkie.root.voting as BoardVoting;
    expect(started).toMatchObject({ status: "active", startedBy: "u1" });

    // The observed session drives the toolbar: the stamp becomes Vote.
    yorkie.voting = started;
    rerender();
    expect(screen.getByRole("button", { name: "Vote" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Voting in progress" })).toBeTruthy();

    const before = store.batches;
    click();
    expect(store.batches).toBe(before + 1);
    expect((yorkie.root.voting as BoardVoting).ballots.u1).toEqual(["a"]);
    expect(yorkie.root.stamps).toEqual({});
  });

  it("keeps Start voting out of the stamp menu", async () => {
    mount(false);
    await userEvent.click(screen.getByRole("button", { name: "Stamps" }));
    expect(await screen.findByRole("menuitemradio", { name: /\+1/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Start voting/ })).toBeNull();
    await userEvent.keyboard("{Escape}");
  });

  it("picks the vote tool back up from the Facilitate group while a vote is open", async () => {
    yorkie.voting = createVoting({
      id: "v1",
      prompt: "",
      perPerson: 3,
      onlyStickies: false,
      userKey: "u2",
      userName: "Bo",
    });
    const { tool } = mount(false);
    act(() => tool.setMode("comment"));
    await userEvent.click(screen.getByRole("button", { name: "Voting in progress" }));
    expect(tool.get().mode).toBe("stamp");
  });

  it("gives the tool back when the vote ends", () => {
    const { tool, rerender } = mount(false);
    const voting = createVoting({
      id: "v1",
      prompt: "",
      perPerson: 3,
      onlyStickies: false,
      userKey: "u2",
      userName: "Bo",
    });
    yorkie.voting = voting;
    rerender();
    act(() => tool.setMode("stamp"));
    yorkie.voting = { ...voting, status: "ended" };
    rerender();
    expect(tool.get().mode).toBe("none");
  });
});
