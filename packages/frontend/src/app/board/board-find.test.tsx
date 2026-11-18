import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Element } from "@wafflebase/slides";
import type { Viewport } from "@wafflebase/board";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildStickyInit } from "./sticky";
import { elementText, findMatches, frameOnScreen, matchViewport } from "./board-find";
import { BoardFindBox } from "./board-find-box";
import { createViewportSignal, type BoardNav } from "./board-nav";
import { NO_INSETS } from "./fit-insets";

function stickyWith(id: string, text: string, x: number, y: number): Element {
  const init = buildStickyInit("#FFF8B8", { x: x + 90, y: y + 90 }) as Element;
  const el = { ...init, id } as Element;
  if (el.type === "shape" && el.data.text) {
    el.data.text.blocks[0].inlines = [{ text, style: {} }];
  }
  return el;
}

const textBox = (id: string, text: string, x: number, y: number) =>
  ({
    id,
    type: "text",
    frame: { x, y, w: 300, h: 40, rotation: 0 },
    data: { blocks: [{ id: "b", type: "paragraph", inlines: [{ text, style: {} }], style: {} }] },
  }) as unknown as Element;

const elements: Element[] = [
  stickyWith("late", "Launch plan", 600, 400),
  stickyWith("first", "launch date?", 0, 0),
  textBox("t", "Nothing here", 0, 900),
  stickyWith("mid", "Pre-LAUNCH", 400, 10),
  { id: "img", type: "image", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { src: "" } } as unknown as Element,
];

describe("elementText", () => {
  it("reads sticky and text-box text, and nothing from an image", () => {
    expect(elementText(elements[0])).toBe("Launch plan");
    expect(elementText(elements[2])).toBe("Nothing here");
    expect(elementText(elements[4])).toBe("");
  });

  it("reads a connector's label, and nothing from an unlabelled one", () => {
    const connector = {
      id: "c",
      type: "connector",
      frame: { x: 0, y: 0, w: 100, h: 0, rotation: 0 },
      label: { blocks: [{ id: "b", type: "paragraph", inlines: [{ text: "depends on", style: {} }], style: {} }] },
    } as unknown as Element;
    expect(elementText(connector)).toBe("depends on");
    expect(elementText({ ...connector, label: undefined } as Element)).toBe("");
  });
});

describe("findMatches", () => {
  it("matches case-insensitively in reading order", () => {
    expect(findMatches(elements, "launch")).toEqual(["first", "mid", "late"]);
  });

  it("matches nothing for a blank query", () => {
    expect(findMatches(elements, "   ")).toEqual([]);
  });
});

describe("matchViewport", () => {
  const host = { w: 1000, h: 800 };
  it("brings a far match on screen, at least at 100%", () => {
    const vp = matchViewport(
      { x: 5000, y: 5000, w: 180, h: 180, rotation: 0 },
      host,
      { panX: 0, panY: 0, zoom: 0.1 },
    )!;
    expect(vp.zoom).toBe(1);
    const r = frameOnScreen({ x: 5000, y: 5000, w: 180, h: 180, rotation: 0 }, vp);
    expect(r.x + r.w / 2).toBeCloseTo(500);
    expect(r.y + r.h / 2).toBeCloseTo(400);
  });

  it("keeps a reader's zoom-in, capped at 200%", () => {
    const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    expect(matchViewport(frame, host, { panX: 0, panY: 0, zoom: 1.5 })!.zoom).toBe(1.5);
    expect(matchViewport(frame, host, { panX: 0, panY: 0, zoom: 6 })!.zoom).toBe(2);
  });
});

describe("BoardFindBox", () => {
  function setup() {
    const signal = createViewportSignal();
    let vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    const commits: Viewport[] = [];
    const nav: BoardNav = {
      getViewport: () => vp,
      getHost: () => ({ w: 1000, h: 800 }),
      getInsets: () => NO_INSETS,
      commit: (next) => {
        vp = next;
        commits.push(next);
        signal.emit(next);
      },
      subscribe: signal.subscribe,
    };
    const onClose = vi.fn();
    render(
      <TooltipProvider>
        <BoardFindBox nav={nav} readElements={() => elements} focusRequest={0} onClose={onClose} />
      </TooltipProvider>,
    );
    return { commits, onClose };
  }

  it("counts matches, jumps to the first, and Enter cycles with wrap-around", async () => {
    const { commits } = setup();
    const input = screen.getByRole("textbox", { name: "Find on board" });
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, "launch");
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.getByTestId("board-find-highlight")).toBeTruthy();
    const afterTyping = commits.length;
    expect(afterTyping).toBeGreaterThan(0);

    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("2/3")).toBeTruthy();
    await userEvent.keyboard("{Enter}{Enter}");
    expect(screen.getByText("1/3")).toBeTruthy();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByText("3/3")).toBeTruthy();
    expect(commits.length).toBe(afterTyping + 4);
  });

  it("shows 0/0 for a miss and closes on Escape", async () => {
    const { onClose } = setup();
    const input = screen.getByRole("textbox", { name: "Find on board" });
    await userEvent.type(input, "zebra");
    expect(screen.getByText("0/0")).toBeTruthy();
    expect(screen.queryByTestId("board-find-highlight")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
