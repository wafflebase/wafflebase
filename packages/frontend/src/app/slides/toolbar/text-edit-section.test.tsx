/**
 * The text-edit Done button is a quiet toolbar control, not a syrup
 * primary fill: it is the exit from the most frequent task, not the
 * view's primary action (DESIGN.md, One Accent Rule). The shared
 * text-formatting groups are stubbed — only Done is under test.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SlidesEditor } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ToolbarState } from "./state";
import { TextEditSection } from "./text-edit-section";

vi.mock("@/components/text-formatting", () => ({
  TextFormatGroup: () => null,
  TextParagraphGroup: () => null,
  FontFamilyPicker: () => null,
  FontSizePicker: () => null,
  useResolvedFontSize: () => 14,
  useResolvedFontFamily: () => "Arial",
  ensureFontLink: () => {},
  clampFontSize: (n: number) => n,
}));

function renderSection(editor: SlidesEditor | null) {
  const state = {
    kind: "text-edit",
    textEditor: {},
  } as unknown as Extract<ToolbarState, { kind: "text-edit" }>;
  render(
    <TooltipProvider>
      <TextEditSection state={state} editor={editor} />
    </TooltipProvider>,
  );
  return screen.getByRole("button", { name: "Done editing text" });
}

describe("TextEditSection Done", () => {
  it("keeps its visible label and exits text editing", async () => {
    const exitTextEditing = vi.fn();
    const done = renderSection({ exitTextEditing } as unknown as SlidesEditor);
    expect(done).toHaveTextContent("Done");
    await userEvent.click(done);
    expect(exitTextEditing).toHaveBeenCalledTimes(1);
  });

  it("is not a primary (syrup) fill", () => {
    const done = renderSection({
      exitTextEditing: () => {},
    } as unknown as SlidesEditor);
    expect(done.className).not.toMatch(/\bbg-primary\b/);
    expect(done.className).not.toContain("text-primary-foreground");
    expect(done.className).toContain("hover:bg-muted");
  });

  it("is disabled without an editor", () => {
    expect(renderSection(null)).toBeDisabled();
  });
});
