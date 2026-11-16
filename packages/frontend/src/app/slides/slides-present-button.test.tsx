/**
 * The header Present split button carries Google Slides' "Slideshow"
 * label next to its play glyph, and keeps the options dropdown.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PresentButton } from "./slides-present-button";

function renderButton(disabled = false) {
  const onStart = vi.fn();
  render(
    <TooltipProvider>
      <PresentButton disabled={disabled} onStart={onStart} />
    </TooltipProvider>,
  );
  return onStart;
}

describe("PresentButton", () => {
  it("is named by its visible Slideshow label", () => {
    renderButton();
    const button = screen.getByRole("button", { name: "Slideshow" });
    expect(button).toHaveTextContent("Slideshow");
  });

  it("presents from the current slide on a primary click", async () => {
    const onStart = renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Slideshow" }));
    expect(onStart).toHaveBeenCalledWith("current");
  });

  it("keeps the options dropdown with both entry points", async () => {
    const onStart = renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: "Present options" }),
    );
    await userEvent.click(await screen.findByText("Present from beginning"));
    expect(onStart).toHaveBeenCalledWith("first");
  });

  it("disables both halves when there is nothing to present", () => {
    renderButton(true);
    expect(screen.getByRole("button", { name: "Slideshow" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Present options" }),
    ).toBeDisabled();
  });
});
