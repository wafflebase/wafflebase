/**
 * `useCanvasFocusRelease` — issue #882.
 *
 * The failure being guarded: after any toolbar control is used, the focused
 * toolbar `<button>` becomes the `keydown` target and the slides editor
 * skips every shortcut rule. These tests drive a miniature toolbar (a plain
 * button, a Radix dropdown, a text input) the way the repro does and assert
 * where focus ends up.
 */

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCanvasFocusRelease } from "./toolbar-focus-release";

function Harness() {
  useCanvasFocusRelease();
  return (
    <div data-canvas-toolbar="">
      <button type="button">Format painter</button>
      <input aria-label="Zoom" defaultValue="100%" />
      <DropdownMenu>
        <DropdownMenuTrigger>Arrange</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Bring to front</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* A controlled palette trigger whose popup is already open: it
          keeps focus, the way the color palettes' controlled DropdownMenu
          triggers do while their swatch grid is showing. */}
      <button type="button" aria-expanded="true" data-state="open">
        Text color
      </button>
      {/* A pressed Radix `Toggle`. `data-state="on"` is NOT an open popup,
          so a pressed toggle must still be released. */}
      <button type="button" data-state="on">
        Bold
      </button>
      {/* A text-edit keepalive control: focus parked here keeps the
          in-place text box mounted, so the canvas must not take the
          keyboard back. */}
      <button type="button" data-text-edit-keepalive>
        Text alignment
      </button>
    </div>
  );
}

/** Focus back on the body is what makes the canvas the keydown target. */
async function expectFocusReleased() {
  await waitFor(() => expect(document.activeElement).toBe(document.body));
}

describe("useCanvasFocusRelease", () => {
  it("releases focus after a plain toolbar button is clicked", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Format painter" }));
    await expectFocusReleased();
  });

  it("keeps focus on a trigger whose popup is open", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Text color" });
    await userEvent.click(trigger);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Blurring the trigger out from under its own open popup would close
    // the popup the click just opened.
    expect(document.activeElement).toBe(trigger);
  });

  it("releases focus from a pressed toggle", async () => {
    render(<Harness />);
    // `data-state="on"` is Radix `Toggle`'s pressed state, not an open
    // popup — Bold / Italic must still hand the keyboard back.
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    await expectFocusReleased();
  });

  it("keeps focus on a text-edit keepalive control", async () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Text alignment" });
    await userEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The text box behind the toolbar is still mounted; releasing here
    // would re-arm Delete / type-to-edit against the element being edited.
    expect(document.activeElement).toBe(button);
  });

  it("releases focus when the menu is dismissed with Escape", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    await expectFocusReleased();
  });

  it("releases focus after a menu item is selected", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    await userEvent.click(await screen.findByRole("menuitem"));
    await expectFocusReleased();
  });

  it("leaves a focused toolbar input alone", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Zoom");
    await userEvent.click(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(input);
  });

  it("keeps focus when the toolbar is reached with Tab", async () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Format painter" });
    // A prior pointer interaction must not make the next Tab release focus.
    await userEvent.click(button);
    await expectFocusReleased();
    await userEvent.tab();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(button);
  });
});
