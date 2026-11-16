/**
 * The Share trigger is shared by every editor header, so its label is
 * asserted once here: visible "Share" text (screen-reader-only below md)
 * and the `aria-label="Share"` the template seed script clicks.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShareDialog } from "./share-dialog";

describe("ShareDialog trigger", () => {
  it("carries a visible Share label beside its icon", () => {
    render(
      <TooltipProvider>
        <ShareDialog documentId="doc-1" />
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Share" });
    expect(trigger).toHaveAttribute("aria-label", "Share");
    const label = trigger.querySelector("span");
    expect(label).toHaveTextContent("Share");
    // Below md the header is the mobile shell's: the label collapses to a
    // screen-reader-only name rather than disappearing.
    expect(label?.className).toContain("sr-only");
    expect(label?.className).toContain("md:not-sr-only");
  });
});
