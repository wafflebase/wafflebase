import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SlidesEditor } from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardToolbar } from "./board-toolbar";
import { YorkieBoardStore } from "./yorkie-board-store";
import { makeYorkieBoardDoc } from "./__testkit__";
import { buildStickyInit } from "./sticky";

/** An editor with `ids` selected and nothing else going on. */
function editorSelecting(ids: string[]) {
  return {
    getInsertMode: () => null,
    setInsertMode: vi.fn(),
    onInsertModeChange: () => () => {},
    onSelectionChange: () => () => {},
    onTextEditingChange: () => () => {},
    onCellSelectionChange: () => () => {},
    getSelection: () => ids,
    isTextEditing: () => false,
    getEditingElementId: () => null,
    getActiveTextEditor: () => null,
    getCellSelection: () => null,
    getCurrentSlideId: () => SYNTHETIC_SLIDE_ID,
  } as unknown as SlidesEditor;
}

function renderWith(ids: string[], store: YorkieBoardStore) {
  render(
    <TooltipProvider>
      <BoardToolbar
        editor={editorSelecting(ids)}
        store={store}
        gridKind="dot"
        onGridKindChange={() => {}}
        gridSnap={false}
        onGridSnapChange={() => {}}
      />
    </TooltipProvider>,
  );
}

describe("BoardToolbar sticky controls", () => {
  it("gives a mixed selection containing a sticky the sticky colour row only", () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    let sticky = "";
    let image = "";
    store.batch(() => {
      sticky = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit("#FFF8B8", { x: 0, y: 0 }));
      image = store.addElement(SYNTHETIC_SLIDE_ID, {
        type: "image",
        frame: { x: 300, y: 0, w: 100, h: 100, rotation: 0 },
        data: { src: "https://example.com/a.png" },
      });
    });
    renderWith([sticky, image], store);
    expect(screen.getByRole("group", { name: "Sticky note color" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Increase text size" })).toBeNull();
  });

  it("gives a sticky-only selection the full sticky toolbar", () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    let sticky = "";
    store.batch(() => {
      sticky = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit("#FFF8B8", { x: 0, y: 0 }));
    });
    renderWith([sticky], store);
    expect(screen.getByRole("group", { name: "Sticky note color" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase text size" })).toBeTruthy();
  });
});
