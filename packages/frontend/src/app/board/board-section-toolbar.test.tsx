import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SECTION_COLORS, sectionOf } from "@wafflebase/board";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SectionControls, SectionToolItems } from "./board-section-toolbar";
import {
  createSection,
  createSectionTool,
  readElements,
  type BoardSections,
} from "./board-sections";
import { YorkieBoardStore } from "./yorkie-board-store";
import { makeYorkieBoardDoc } from "./__testkit__";

function fakeSections(): BoardSections & { goTo: ReturnType<typeof vi.fn>; rename: ReturnType<typeof vi.fn> } {
  return {
    tool: createSectionTool(),
    editorOptions: {},
    canvasMenuItems: () => [],
    insertMenuItems: () => [],
    rename: vi.fn(),
    goTo: vi.fn(),
    wrapSelection: vi.fn(),
    attach: () => () => {},
  };
}

describe("SectionToolItems", () => {
  it("arms the section tool and follows it when it changes elsewhere", async () => {
    const sections = fakeSections();
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    render(
      <TooltipProvider>
        <SectionToolItems sections={sections} store={store} />
      </TooltipProvider>,
    );
    const toggle = screen.getByRole("button", { name: "Section" });
    await userEvent.click(toggle);
    expect(sections.tool.get()).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    act(() => sections.tool.set(false));
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("lists sections and goes to the one picked", async () => {
    const sections = fakeSections();
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    const id = createSection(store, { x: 0, y: 0, w: 100, h: 100 }, { title: "Retro" });
    render(
      <TooltipProvider>
        <SectionToolItems sections={sections} store={store} />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sections" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Retro/ }));
    expect(sections.goTo).toHaveBeenCalledWith(id);
  });
});

describe("SectionControls", () => {
  it("recolours, hides and locks the selected section", async () => {
    const sections = fakeSections();
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    const id = createSection(store, { x: 0, y: 0, w: 100, h: 100 }, { title: "Q1" });
    const editor = { setSelection: vi.fn() };
    const view = () => (
      <TooltipProvider>
        <SectionControls sections={sections} store={store} editor={editor} ids={[id]} />
      </TooltipProvider>
    );
    const { rerender } = render(view());
    await userEvent.click(screen.getByRole("button", { name: SECTION_COLORS[3].name }));
    const data = (readElements(store)[0] as { data: { fill: { value: string } } }).data;
    expect(data.fill.value).toBe(SECTION_COLORS[3].fill);

    await userEvent.click(screen.getByRole("button", { name: "Hide contents" }));
    expect(sectionOf(readElements(store)[0])?.hidden).toBe(true);
    rerender(view());
    expect(screen.getByRole("button", { name: "Reveal contents" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Lock section" }));
    expect(sectionOf(readElements(store)[0])?.locked).toBe(true);
    expect(editor.setSelection).toHaveBeenCalledWith([]);

    await userEvent.click(screen.getByRole("button", { name: "Rename section" }));
    expect(sections.rename).toHaveBeenCalledWith(id);
  });
});
