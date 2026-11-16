import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SlidesEditor } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardToolbar } from "./board-toolbar";
import { createHandTool } from "./board-hand";

/** An idle editor: nothing selected, no text edit, no insert tool. */
function fakeEditor() {
  return {
    getInsertMode: () => null,
    setInsertMode: vi.fn(),
    onInsertModeChange: () => () => {},
    onSelectionChange: () => () => {},
    onTextEditingChange: () => () => {},
    getSelection: () => [],
    isTextEditing: () => false,
    getEditingElementId: () => null,
    getActiveTextEditor: () => null,
    getCellSelection: () => null,
    getCurrentSlideId: () => "board",
  } as unknown as SlidesEditor & { setInsertMode: ReturnType<typeof vi.fn> };
}

function renderToolbar(editor: SlidesEditor, hand = createHandTool()) {
  render(
    <TooltipProvider>
      <BoardToolbar
        editor={editor}
        hand={hand}
        gridKind="dot"
        onGridKindChange={() => {}}
        gridSnap={false}
        onGridSnapChange={() => {}}
      />
    </TooltipProvider>,
  );
  return hand;
}

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("BoardToolbar hand toggle", () => {
  it("arms the hand and takes Select's pressed state", async () => {
    const hand = renderToolbar(fakeEditor());
    expect(pressed("Select")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Hand" }));
    expect(hand.get()).toBe(true);
    expect(pressed("Hand")).toBe("true");
    expect(pressed("Select")).toBe("false");
  });

  it("follows hand state changed elsewhere (the H key, Esc)", () => {
    const hand = renderToolbar(fakeEditor());
    act(() => hand.set(true));
    expect(pressed("Hand")).toBe("true");
    act(() => hand.set(false));
    expect(pressed("Hand")).toBe("false");
    expect(pressed("Select")).toBe("true");
  });

  it("disarms the hand when Select is clicked", async () => {
    const editor = fakeEditor();
    const hand = renderToolbar(editor);
    act(() => hand.set(true));
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(hand.get()).toBe(false);
    expect(editor.setInsertMode).toHaveBeenCalledWith(null);
  });
});
