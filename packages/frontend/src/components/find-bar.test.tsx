import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Spreadsheet } from "@wafflebase/sheets";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FindBar } from "./find-bar";

function fakeSpreadsheet() {
  return {
    find: vi.fn().mockResolvedValue(0),
    findNext: vi.fn().mockResolvedValue(undefined),
    findPrevious: vi.fn().mockResolvedValue(undefined),
    clearFind: vi.fn(),
    getSearchState: vi.fn().mockReturnValue({ total: 0, currentIndex: -1 }),
    returnFocusToGrid: vi.fn(),
  };
}

function renderBar(
  spreadsheet: ReturnType<typeof fakeSpreadsheet>,
  focusRequest: number,
  onClose = vi.fn(),
) {
  return render(
    <TooltipProvider>
      <FindBar
        spreadsheet={spreadsheet as unknown as Spreadsheet}
        focusRequest={focusRequest}
        onClose={onClose}
      />
    </TooltipProvider>,
  );
}

describe("FindBar", () => {
  it("focuses its input when it opens", () => {
    renderBar(fakeSpreadsheet(), 0);
    expect(document.activeElement).toBe(screen.getByLabelText("Find in sheet"));
  });

  // Cmd/Ctrl+F while the bar is already open (focus back in the grid) must
  // bring the keyboard back to the query, selected so typing replaces it.
  it("refocuses and selects the query on a repeated Find", () => {
    const spreadsheet = fakeSpreadsheet();
    const { rerender } = renderBar(spreadsheet, 0);
    const input = screen.getByLabelText("Find in sheet") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "rent" } });
    input.blur();
    expect(document.activeElement).not.toBe(input);

    rerender(
      <TooltipProvider>
        <FindBar
          spreadsheet={spreadsheet as unknown as Spreadsheet}
          focusRequest={1}
          onClose={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("rent".length);
  });

  // The count used to read "0/0" from the moment a query was typed until its
  // scan returned — next to a highlight (or selection) the previous search
  // left on the grid, a count that contradicts what is on screen.
  it("shows a count only for the query it describes", async () => {
    vi.useFakeTimers();
    try {
      const spreadsheet = fakeSpreadsheet();
      let resolveFind!: (n: number) => void;
      spreadsheet.find.mockImplementation(
        () => new Promise<number>((resolve) => (resolveFind = resolve)),
      );
      renderBar(spreadsheet, 0);
      const input = screen.getByLabelText("Find in sheet");

      fireEvent.change(input, { target: { value: "rent" } });
      expect(screen.queryByText("0/0")).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(spreadsheet.find).toHaveBeenCalledWith("rent");
      expect(screen.queryByText("0/0")).toBeNull();

      spreadsheet.getSearchState.mockReturnValue({ total: 2, currentIndex: 0 });
      await act(async () => {
        resolveFind(2);
      });
      expect(screen.getByText("1/2")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the keyboard back to the grid when closed with Escape", () => {
    const spreadsheet = fakeSpreadsheet();
    const onClose = vi.fn();
    renderBar(spreadsheet, 0, onClose);

    fireEvent.keyDown(screen.getByLabelText("Find in sheet"), {
      key: "Escape",
    });

    expect(spreadsheet.clearFind).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(spreadsheet.returnFocusToGrid).toHaveBeenCalled();
  });
});
