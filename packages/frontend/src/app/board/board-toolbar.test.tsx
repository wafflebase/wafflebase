import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SlidesEditor } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardToolbar } from "./board-toolbar";

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
  } as unknown as SlidesEditor;
}

describe("BoardToolbar", () => {
  // The insert tools moved to the bottom tool dock (`board-tool-dock.tsx`);
  // the top bar keeps the view controls and the contextual ones.
  it("keeps the view controls and none of the insert tools", () => {
    render(
      <TooltipProvider>
        <BoardToolbar
          editor={fakeEditor()}
          gridKind="dot"
          onGridKindChange={() => {}}
          gridSnap={false}
          onGridSnapChange={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: /^Grid:/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sections" })).toBeTruthy();
    for (const name of ["Select", "Hand", "Text box", "Sticky note", "Shape", "Line", "Eraser", "Section", "Insert image"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });
});
