import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CellStyle, Spreadsheet } from "@wafflebase/sheets";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FormattingToolbar } from "./formatting-toolbar";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

/**
 * A stand-in for the `Spreadsheet` the toolbar reads its state from. Only the
 * methods the toolbar calls exist; `applyStyle` records what it was asked to
 * write and feeds it back as the active style, the way the real sheet does.
 */
function fakeSpreadsheet(initial?: CellStyle) {
  let style: CellStyle | undefined = initial;
  const listeners = new Set<() => void>();
  const applyStyle = vi.fn(async (patch: Partial<CellStyle>) => {
    style = { ...(style ?? {}), ...patch };
    listeners.forEach((listener) => listener());
  });
  const toggleStyle = vi.fn();
  const spreadsheet = {
    getActiveStyle: async () => style,
    getActiveEffectiveAlign: async () => "left" as const,
    isSelectionMerged: () => false,
    canMergeSelection: () => false,
    hasFilter: () => false,
    isCheckboxActive: () => false,
    isListActive: () => false,
    onSelectionChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyStyle,
    toggleStyle,
  } as unknown as Spreadsheet;
  return { spreadsheet, applyStyle, toggleStyle };
}

function renderToolbar(initial?: CellStyle) {
  const fake = fakeSpreadsheet(initial);
  render(
    <TooltipProvider>
      <FormattingToolbar spreadsheet={fake.spreadsheet} />
    </TooltipProvider>,
  );
  return fake;
}

async function openMoreFormats() {
  await userEvent.click(screen.getByRole("button", { name: "More formats" }));
  return screen.findByRole("menu");
}

describe("FormattingToolbar number formats", () => {
  it("labels the currency button with the currency it applies", async () => {
    const { applyStyle } = renderToolbar();
    // jsdom reports en-US, whose currency is the US dollar.
    const button = screen.getByRole("button", {
      name: "Format as currency (USD)",
    });
    await userEvent.click(button);
    expect(applyStyle).toHaveBeenCalledWith({
      nf: "currency",
      cu: "USD",
      dp: 2,
    });
  });

  it("offers Google's format list without inert rows", async () => {
    renderToolbar();
    const menu = await openMoreFormats();
    const labels = within(menu)
      .getAllByRole("menuitemcheckbox")
      .map((item) => item.textContent);
    expect(labels).toEqual([
      "Plain text",
      "Number1,000.12",
      "Percent10.12%",
      "Scientific1.00E+03",
      "Accounting($1,000.12)",
      "Financial(1,000.12)",
      "Currency$1,000.12",
      "Currency rounded$1,000",
      "Date2008-09-26",
      "Time15:59:00",
      "Date time2008-09-26 15:59:00",
    ]);
    expect(within(menu).queryByText(/US examples|preview/i)).toBeNull();
  });

  it("checks only the applied format", async () => {
    renderToolbar({ nf: "currency", cu: "USD", dp: 0 });
    const menu = await openMoreFormats();
    await waitFor(() => {
      const checked = within(menu)
        .getAllByRole("menuitemcheckbox")
        .filter((item) => item.getAttribute("aria-checked") === "true")
        .map((item) => item.textContent);
      expect(checked).toEqual(["Currency rounded$1,000"]);
    });
  });

  it("applies the chosen preset's full style", async () => {
    const { applyStyle } = renderToolbar();
    const menu = await openMoreFormats();
    await userEvent.click(within(menu).getByText("Scientific"));
    expect(applyStyle).toHaveBeenCalledWith({ nf: "scientific", dp: 2 });
  });
});

describe("FormattingToolbar text style", () => {
  it("has an underline toggle", async () => {
    const { toggleStyle } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: "Underline" }));
    expect(toggleStyle).toHaveBeenCalledWith("u");
  });
});
