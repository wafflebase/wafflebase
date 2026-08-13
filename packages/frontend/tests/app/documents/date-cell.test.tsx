import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DateCell } from "@/app/documents/document-list";
import {
  formatExactDate,
  formatFullDateTime,
} from "@/app/documents/document-list-utils";
import { setDateFormat } from "@/lib/date-format-preference";

/**
 * These cover the wiring the pure helpers cannot: that the cell actually reads
 * the Settings preference, re-renders when it changes, and always carries the
 * full timestamp as its tooltip.
 */
afterEach(() => {
  localStorage.clear();
  // Reset the store's session mirror so a failed-write test cannot leak into
  // the next one.
  setDateFormat("relative");
  localStorage.clear();
});

function cell() {
  return screen.getByTestId("wrap").firstElementChild as HTMLElement;
}

function mount(value: string | undefined) {
  return render(
    <div data-testid="wrap">
      <DateCell value={value} />
    </div>,
  );
}

describe("DateCell", () => {
  it("renders a relative time by default", () => {
    mount("2024-01-01T00:00:00.000Z");

    expect(cell().textContent).toMatch(/ago$/);
  });

  it("renders an exact date when the preference is 'exact'", () => {
    localStorage.setItem("wafflebase-date-format", "exact");
    const value = "2025-12-01T12:00:00.000Z";

    mount(value);

    // Compare against the helper rather than a hardcoded string so the
    // assertion holds under any locale the test runner picks.
    expect(cell().textContent).toBe(formatExactDate(value));
    expect(cell().textContent).not.toMatch(/ago$/);
  });

  it("always exposes the full date and time as the tooltip", () => {
    const value = "2026-07-25T15:30:00.000Z";
    mount(value);

    expect(cell().title).toBe(formatFullDateTime(value));
    expect(cell().title).toMatch(/2026/);
    expect(cell().title).toMatch(/\d{1,2}:\d{2}/);
  });

  it("re-renders when the preference changes elsewhere in the tab", () => {
    // The Settings page and the list are separate route trees, so the cell has
    // to pick up the change without being re-mounted.
    mount("2024-01-01T00:00:00.000Z");
    expect(cell().textContent).toMatch(/ago$/);

    act(() => setDateFormat("exact"));

    expect(cell().textContent).not.toMatch(/ago$/);
    expect(cell().textContent).toBe(
      formatExactDate("2024-01-01T00:00:00.000Z"),
    );
  });

  it("renders an em dash for a missing or unparseable value", () => {
    const { unmount } = mount(undefined);
    expect(cell().textContent).toBe("—");
    expect(cell().title).toBe("—");
    unmount();

    mount("not-a-date");
    expect(cell().textContent).toBe("—");
    expect(cell().title).toBe("—");
  });
});
