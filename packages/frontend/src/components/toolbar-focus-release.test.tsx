/**
 * `useCanvasFocusRelease` — issue #882.
 *
 * The failure being guarded: after any toolbar control is used, the focused
 * toolbar `<button>` becomes the `keydown` target and the slides editor
 * skips every shortcut rule. These tests drive a miniature toolbar (a plain
 * button, a Radix dropdown, a text input) the way the repro does and assert
 * where focus ends up.
 *
 * Every "released" assertion is paired with a control render of the *same*
 * markup without the hook (`<Unhooked />`), which asserts focus stays on the
 * control. Without that pairing an assertion of "focus is on the body" could
 * hold in jsdom whether or not the hook ran, and the tests closest to the
 * real repro would pass vacuously.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCanvasFocusRelease } from "./toolbar-focus-release";

function ToolbarMarkup() {
  return (
    <>
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
      {/* Stands in for the slide canvas — outside the toolbar, and the
          click target that dismisses an open picker. */}
      <div data-testid="canvas" />
    </>
  );
}

function Harness() {
  useCanvasFocusRelease();
  return <ToolbarMarkup />;
}

/** The same toolbar with the hook NOT mounted — the control render. */
function Unhooked() {
  return <ToolbarMarkup />;
}

/** Focus back on the body is what makes the canvas the keydown target. */
async function expectFocusReleased() {
  await waitFor(() => expect(document.activeElement).toBe(document.body));
}

/** Lets a queued `setTimeout(…, 0)` release run (or fail to run). */
function afterOneTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useCanvasFocusRelease", () => {
  it("releases focus after a plain toolbar button is clicked", async () => {
    render(<Harness />);
    await userEvent.click(
      screen.getByRole("button", { name: "Format painter" }),
    );
    await expectFocusReleased();
  });

  it("keeps focus on a trigger whose popup is open", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Text color" });
    await userEvent.click(trigger);
    await afterOneTask();
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
    await afterOneTask();
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

  // The dominant #882 path: the picker is dismissed by clicking the canvas,
  // so the pointerdown lands OUTSIDE the toolbar (on the canvas, or on
  // `html` while a modal Radix layer neutralises the body) — and then the
  // modal Popover's `onCloseAutoFocus` puts focus back on the trigger. A
  // gate that required the pointerdown to land inside the toolbar would
  // skip exactly this case.
  it("releases focus a closing picker hands back after a canvas click", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Format painter" });
    fireEvent.pointerDown(screen.getByTestId("canvas"));
    trigger.focus();
    await expectFocusReleased();
  });

  it("leaves a focused toolbar input alone", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Zoom");
    await userEvent.click(input);
    await afterOneTask();
    expect(document.activeElement).toBe(input);
  });

  it("keeps focus when the toolbar is reached with Tab", async () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Format painter" });
    // A prior pointer interaction must not make the next Tab release focus.
    await userEvent.click(button);
    await expectFocusReleased();
    await userEvent.tab();
    await afterOneTask();
    expect(document.activeElement).toBe(button);
  });
});

/**
 * Controls: the same toolbar without the hook. These pin down what jsdom +
 * Radix do on their own, so the "released" assertions above are known to be
 * measuring the hook rather than ambient behaviour.
 */
describe("useCanvasFocusRelease — control (hook not mounted)", () => {
  it("leaves a clicked plain button focused", async () => {
    render(<Unhooked />);
    const button = screen.getByRole("button", { name: "Format painter" });
    await userEvent.click(button);
    await afterOneTask();
    expect(document.activeElement).toBe(button);
  });

  it("lets Radix return focus to the trigger on Escape", async () => {
    render(<Unhooked />);
    const trigger = screen.getByRole("button", { name: "Arrange" });
    await userEvent.click(trigger);
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    // This is the #882 mechanism itself: the dismissed menu parks focus back
    // on a toolbar <button>, which gates every canvas shortcut.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("lets Radix return focus to the trigger after a menu item is selected", async () => {
    render(<Unhooked />);
    const trigger = screen.getByRole("button", { name: "Arrange" });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("menuitem"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
