/**
 * Follow-up to issue #882: "the first click after closing a toolbar
 * popover is swallowed, and focus stays in the toolbar".
 *
 * jsdom does not hit-test, so the swallowed click cannot be replayed
 * literally. What can be pinned is its mechanism — a modal Radix layer
 * neutralises `body` — and the board's counter-measure: the canvas host
 * carries an explicit `pointer-events: auto`, which a browser honours over
 * the inherited `none` (see `board-click-through.ts`).
 *
 * The focus half is tested with real Radix components and the real
 * `useCanvasFocusRelease` hook, dismissing by a press on the canvas.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCanvasFocusRelease } from "@/components/toolbar-focus-release";
import { allowClickThroughDismiss } from "./board-click-through";

function Board({
  clickThrough = true,
  onCanvasDown,
}: {
  clickThrough?: boolean;
  onCanvasDown?: () => void;
}) {
  useCanvasFocusRelease();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (clickThrough && host.current) allowClickThroughDismiss(host.current);
  }, [clickThrough]);
  return (
    <>
      <div data-canvas-toolbar="">
        <Popover modal>
          <PopoverTrigger>Fill color</PopoverTrigger>
          <PopoverContent>swatches</PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger>Arrange</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Bring to front</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div ref={host} data-testid="host">
        <canvas data-testid="canvas" onPointerDown={onCanvasDown} />
      </div>
    </>
  );
}

afterEach(() => {
  document.body.style.pointerEvents = "";
});

describe("closing a toolbar popover by clicking the board", () => {
  it("a modal popover neutralises the body — the mechanism behind the swallowed click", async () => {
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Fill color" }));
    await screen.findByText("swatches");
    expect(document.body.style.pointerEvents).toBe("none");
    // The board host opts back in, so the canvas under it is hit-testable.
    expect(screen.getByTestId("host").style.pointerEvents).toBe("auto");
  });

  it("a modal dropdown (Arrange) does the same", async () => {
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    await screen.findByRole("menu");
    expect(document.body.style.pointerEvents).toBe("none");
  });

  // user-event refuses a press on an element whose computed
  // `pointer-events` is `none` — the same verdict a browser's hit-test
  // reaches — so this pair measures the real mechanism.
  it("control: without the opt-in, the canvas cannot be pressed while the popover is open", async () => {
    render(<Board clickThrough={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Fill color" }));
    await screen.findByText("swatches");
    await expect(
      userEvent.pointer({ keys: "[MouseLeft]", target: screen.getByTestId("canvas") }),
    ).rejects.toThrow(/pointer-events/);
  });

  it("the canvas press both closes the popover and reaches the canvas", async () => {
    const onCanvasDown = vi.fn();
    render(<Board onCanvasDown={onCanvasDown} />);
    await userEvent.click(screen.getByRole("button", { name: "Fill color" }));
    await screen.findByText("swatches");
    await userEvent.pointer({ keys: "[MouseLeft]", target: screen.getByTestId("canvas") });
    await waitFor(() => expect(screen.queryByText("swatches")).toBeNull());
    expect(onCanvasDown).toHaveBeenCalledTimes(1);
  });

  it("hands focus back to the page (not the trigger) after a canvas dismissal", async () => {
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Fill color" }));
    await screen.findByText("swatches");
    await userEvent.pointer({ keys: "[MouseLeft]", target: screen.getByTestId("canvas") });
    await waitFor(() => expect(screen.queryByText("swatches")).toBeNull());
    // Radix restores focus to the trigger on a timer; the hook releases it
    // on the next task.
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(document.activeElement).toBe(document.body);
  });

  it("hands focus back to the page after the Arrange menu is dismissed on the canvas", async () => {
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    await screen.findByRole("menu");
    await userEvent.pointer({ keys: "[MouseLeft]", target: screen.getByTestId("canvas") });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(document.activeElement).toBe(document.body);
  });
});
