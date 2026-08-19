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

  it("keeps focus on a trigger whose menu is open", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Arrange" });
    await userEvent.click(trigger);
    await screen.findByRole("menu");
    // Radix moves focus into the portalled content; either way the trigger
    // must not be blurred out from under an open menu.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(trigger.getAttribute("data-state")).toBe("open");
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
