/**
 * Right-side panel toggles carry visible text labels (Format / Motion /
 * Background / Theme) — four look-alike glyphs were unreadable to people
 * arriving from Google Slides. jsdom does not evaluate container queries,
 * so these tests pin the DOM contract: the label is in the markup, the
 * accessible name still contains it, and the threshold classes follow
 * `contextWidth`.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RightGlobals, type RightGlobalsProps } from "./global-controls";

function renderGlobals(props: Partial<RightGlobalsProps> = {}) {
  const handlers = {
    onToggleFormatPanel: vi.fn(),
    onToggleMotionPanel: vi.fn(),
    onToggleBackgroundPanel: vi.fn(),
    onToggleThemePanel: vi.fn(),
  };
  render(
    <TooltipProvider>
      <RightGlobals editor={null} store={null} {...handlers} {...props} />
    </TooltipProvider>,
  );
  return handlers;
}

const TOGGLES = [
  ["Toggle format options", "Format"],
  ["Toggle motion panel", "Motion"],
  ["Toggle slide background", "Background"],
  ["Toggle theme picker", "Theme"],
] as const;

describe("RightGlobals panel toggles", () => {
  it.each(TOGGLES)(
    "%s shows the visible label %s inside its accessible name",
    (name, label) => {
      renderGlobals();
      const toggle = screen.getByRole("button", { name });
      expect(toggle).toHaveTextContent(label);
      // WCAG 2.5.3 label-in-name: the text the button renders must be part
      // of the name it computes — both read from the DOM, so a dropped
      // label or a renamed aria-label fails here.
      const rendered = toggle.textContent?.trim() ?? "";
      expect(rendered).not.toBe("");
      expect(toggle).toHaveAccessibleName(new RegExp(rendered, "i"));
    },
  );

  it("keeps the toggles in Format, Motion, Background, Theme order", () => {
    renderGlobals();
    const group = screen.getByLabelText("Slide style");
    expect(group.textContent).toBe("FormatMotionBackgroundTheme");
  });

  it("reflects the open panel as a pressed toggle", () => {
    renderGlobals({ motionPanelOpen: true });
    expect(
      screen.getByRole("button", { name: "Toggle motion panel" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Toggle theme picker" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("calls the matching handler when a toggle is pressed", async () => {
    const handlers = renderGlobals();
    await userEvent.click(
      screen.getByRole("button", { name: "Toggle slide background" }),
    );
    expect(handlers.onToggleBackgroundPanel).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleThemePanel).not.toHaveBeenCalled();
  });

  it("omits a toggle whose handler is not wired", () => {
    renderGlobals({ onToggleMotionPanel: undefined });
    expect(
      screen.queryByRole("button", { name: "Toggle motion panel" }),
    ).toBeNull();
  });

  it("shows labels from a narrower toolbar when nothing is selected", () => {
    renderGlobals({ contextWidth: "compact" });
    const label = screen.getByText("Theme");
    expect(label.className).toContain("@min-[800px]/slides-toolbar:inline");
    expect(label.className).toContain("hidden");
  });

  it("defaults to the wide threshold that text-edit needs", () => {
    renderGlobals();
    const label = screen.getByText("Theme");
    expect(label.className).toContain("@min-[1300px]/slides-toolbar:inline");
  });
});
