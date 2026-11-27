import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  ALL_CATEGORY_SLUGS,
  categoryLabel,
} from "@wafflebase/core/templates";

import { TemplateCategoryItems } from "./template-category-items";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// jsdom lacks the pointer-capture and scroll APIs Radix Select calls when it
// opens its listbox.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

function openPicker(onValueChange: (v: string) => void = () => {}) {
  render(
    <Select value="" onValueChange={onValueChange}>
      <SelectTrigger aria-label="Category">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <TemplateCategoryItems />
      </SelectContent>
    </Select>,
  );
  fireEvent.keyDown(screen.getByLabelText("Category"), { key: "Enter" });
  return screen.getByRole("listbox");
}

describe("TemplateCategoryItems", () => {
  it("offers every slug once, each top followed by its leaves", () => {
    const options = within(openPicker()).getAllByRole("option");
    // Labels are distinct (core pins that), so the label order is the slug
    // order: tops in sort order, each followed by its own leaves.
    expect(options.map((o) => o.textContent)).toEqual(
      ALL_CATEGORY_SLUGS.map(categoryLabel),
    );
  });

  it("selects the stored slug, never the label", () => {
    const onValueChange = vi.fn();
    const listbox = openPicker(onValueChange);

    fireEvent.click(within(listbox).getByRole("option", { name: "Budget" }));
    expect(onValueChange).toHaveBeenLastCalledWith("finance/budget");
  });

  it("lets a bare top be chosen on its own", () => {
    const onValueChange = vi.fn();
    const listbox = openPicker(onValueChange);

    fireEvent.click(
      within(listbox).getByRole("option", { name: "HR & people" }),
    );
    expect(onValueChange).toHaveBeenLastCalledWith("people");
  });
});
