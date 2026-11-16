import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ConditionalFormatRule,
  DataValidationRule,
  Spreadsheet,
} from "@wafflebase/sheets";
import { ConditionalFormatPanel } from "./conditional-format-panel";
import { DataValidationPanel } from "./data-validation-panel";

function fakeSheet(options?: {
  conditionalFormats?: ConditionalFormatRule[];
  dataValidations?: DataValidationRule[];
}) {
  const setConditionalFormats = vi.fn(async () => {});
  const setDataValidations = vi.fn(async () => {});
  const spreadsheet = {
    getConditionalFormats: () => options?.conditionalFormats ?? [],
    setConditionalFormats,
    getDataValidations: () => options?.dataValidations ?? [],
    getDataValidationAt: () => undefined,
    setDataValidations,
  } as unknown as Spreadsheet;
  return { spreadsheet, setConditionalFormats, setDataValidations };
}

const B2E4 = [
  [
    { r: 2, c: 2 },
    { r: 4, c: 5 },
  ],
];

describe("ConditionalFormatPanel", () => {
  it("starts an unsaved rule for an uncovered selection", async () => {
    const { spreadsheet, setConditionalFormats } = fakeSheet();
    render(
      <ConditionalFormatPanel
        spreadsheet={spreadsheet}
        open
        onClose={() => {}}
        getSelectionRange={() => "B2:E4"}
      />,
    );

    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(
      (screen.getByLabelText("Apply to range") as HTMLInputElement).value,
    ).toBe("B2:E4");
    expect(setConditionalFormats).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(setConditionalFormats).toHaveBeenLastCalledWith([
      expect.objectContaining({
        ranges: B2E4,
        op: "isNotEmpty",
        // Google's default fill, with text that stays dark in dark mode.
        style: { bg: "#B7E1CD", tc: "#000000" },
      }),
    ]);
    expect(screen.queryByText("Unsaved")).toBeNull();
  });

  it("keeps the draft out of the sheet until Done", async () => {
    const { spreadsheet, setConditionalFormats } = fakeSheet();
    render(
      <ConditionalFormatPanel
        spreadsheet={spreadsheet}
        open
        onClose={() => {}}
        getSelectionRange={() => "B2:E4"}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Toggle bold" }));
    expect(setConditionalFormats).toHaveBeenLastCalledWith([]);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Unsaved")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("selects an existing rule instead of drafting one", () => {
    const { spreadsheet } = fakeSheet({
      conditionalFormats: [
        {
          id: "cf-1",
          ranges: [[{ r: 3, c: 3 }, { r: 3, c: 3 }]],
          op: "isEmpty",
          style: { bg: "#B7E1CD" },
        },
      ],
    });
    render(
      <ConditionalFormatPanel
        spreadsheet={spreadsheet}
        open
        onClose={() => {}}
        getSelectionRange={() => "B2:E4"}
      />,
    );
    expect(screen.queryByText("Unsaved")).toBeNull();
    expect(
      (screen.getByLabelText("Apply to range") as HTMLInputElement).value,
    ).toBe("C3:C3");
  });
});

describe("DataValidationPanel", () => {
  it("starts an unsaved dropdown rule that Cancel discards", async () => {
    const { spreadsheet, setDataValidations } = fakeSheet();
    render(
      <DataValidationPanel
        spreadsheet={spreadsheet}
        open
        onClose={() => {}}
        getSelectionRange={() => "B2:E4"}
      />,
    );

    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(
      (screen.getByLabelText("Apply to range") as HTMLInputElement).value,
    ).toBe("B2:E4");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Unsaved")).toBeNull();
    expect(setDataValidations).not.toHaveBeenCalled();
  });

  it("keeps Done disabled until the dropdown has an option", () => {
    const { spreadsheet } = fakeSheet();
    render(
      <DataValidationPanel
        spreadsheet={spreadsheet}
        open
        onClose={() => {}}
        getSelectionRange={() => "B2:E4"}
      />,
    );
    const done = screen.getByRole("button", { name: "Done" });
    expect((done as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the options still being typed when Done is clicked", async () => {
    const { spreadsheet, setDataValidations } = fakeSheet();
    render(
      <DataValidationPanel
        spreadsheet={spreadsheet}
        open
        onClose={() => {}}
        getSelectionRange={() => "B2:E4"}
      />,
    );
    // No blur before Done: clicking Done is what would blur the textarea.
    await userEvent.type(
      screen.getByLabelText("Options (one per line)"),
      "Red{enter}Green",
    );
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByText("Unsaved")).toBeNull();
    const saved = setDataValidations.mock.calls.at(-1)?.[0] as
      | DataValidationRule[]
      | undefined;
    expect(saved).toHaveLength(1);
    expect(saved?.[0]).toMatchObject({ kind: "list", list: ["Red", "Green"] });
  });

  it("opens on the list when nothing is selected", () => {
    const { spreadsheet } = fakeSheet();
    render(
      <DataValidationPanel
        spreadsheet={spreadsheet}
        open
        onClose={() => {}}
        getSelectionRange={() => null}
      />,
    );
    expect(screen.queryByText("Unsaved")).toBeNull();
    expect(screen.getByText("Add a rule and choose a range to validate.")).toBeTruthy();
  });
});
