import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { SlidesEditor } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { YorkieBoardStore } from "./yorkie-board-store";
import { createDrawingTools } from "./board-drawing-extras";
import type { BoardPresenceController } from "./board-presence";
import type { BoardVoting } from "./rituals/types";

let mobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));
// The Yorkie selector needs a live `DocumentProvider`; feed the session.
const yorkie = vi.hoisted(() => ({ voting: null as BoardVoting | null }));
vi.mock("./rituals/use-board-voting", () => ({
  useBoardVoting: () => yorkie.voting,
}));

import { BoardFacilitateControls } from "./board-facilitate-controls";
import { BoardCollabContext, type BoardCollabValue } from "./rituals/board-collab-hook";
import { createRitualTool } from "./rituals/ritual-tool";

const store = {
  readTimer: () => undefined,
  writeTimer: () => undefined,
  onChange: () => () => undefined,
  batch: (fn: () => void) => fn(),
  updateRituals: () => undefined,
} as unknown as YorkieBoardStore;

const presence = {
  isSpotlighting: () => false,
  setSpotlight: () => undefined,
  subscribe: () => () => undefined,
} as unknown as BoardPresenceController;

function collab(readOnly = false): BoardCollabValue {
  return {
    readOnly,
    user: { key: "u1", name: "Ada", author: { userId: "1", username: "Ada" } },
    tool: createRitualTool(),
  } as unknown as BoardCollabValue;
}

function mount({ value = collab() as BoardCollabValue | null } = {}) {
  const drawingTools = createDrawingTools();
  const ui: ReactNode = (
    <TooltipProvider>
      <BoardCollabContext.Provider value={value}>
        <BoardFacilitateControls
          store={store}
          editor={{} as SlidesEditor}
          presence={presence}
          laser={drawingTools.laser}
        />
      </BoardCollabContext.Provider>
    </TooltipProvider>
  );
  render(ui);
  return { drawingTools };
}

afterEach(() => {
  mobile = false;
  yorkie.voting = null;
});

describe("BoardFacilitateControls", () => {
  it("groups Timer, Vote, Spotlight and Laser, in that order", () => {
    mount();
    const group = screen.getByRole("group", { name: "Facilitate" });
    const names = within(group)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Timer", "Start voting", "Spotlight me", "Laser pointer"]);
  });

  it("opens the Start voting form from Vote", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Start voting" }));
    expect(await screen.findByRole("dialog", { name: "Start voting" })).toBeTruthy();
  });

  it("toggles the laser pointer, the same tool as Shift+K", async () => {
    const { drawingTools } = mount();
    const laser = screen.getByRole("button", { name: "Laser pointer" });
    await userEvent.click(laser);
    expect(drawingTools.laser.get()).toBe(true);
    expect(laser.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(laser);
    expect(drawingTools.laser.get()).toBe(false);
  });

  it("offers no Vote without a collab provider or to a read-only user", () => {
    mount({ value: null });
    expect(screen.queryByRole("button", { name: /voting/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Laser pointer" })).toBeTruthy();
    cleanup();
    mount({ value: collab(true) });
    expect(screen.queryByRole("button", { name: /voting/i })).toBeNull();
  });

  it("folds into one Facilitate trigger on a phone", async () => {
    mobile = true;
    mount();
    expect(screen.queryByRole("button", { name: "Laser pointer" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Facilitate" });
    await userEvent.click(trigger);
    for (const name of ["Timer", "Start voting", "Spotlight me", "Laser pointer"]) {
      expect(await screen.findByRole("button", { name })).toBeTruthy();
    }
  });

  it("washes the folded trigger while a vote is open", () => {
    mobile = true;
    yorkie.voting = { status: "active" } as BoardVoting;
    mount();
    expect(screen.getByRole("button", { name: "Facilitate" }).className).toContain("bg-selected");
  });
});
