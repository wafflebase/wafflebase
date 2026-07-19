import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewsTrendChart } from "./views-trend-chart";
import { DateRangePicker } from "./date-range";

describe("ViewsTrendChart", () => {
  it("shows an empty state when there is no series", () => {
    render(<ViewsTrendChart data={[]} />);
    expect(screen.getByText(/no views in this range/i)).toBeTruthy();
  });

  it("mounts the chart without throwing when given a series", () => {
    // recharts renders inside a ResponsiveContainer (0-sized in jsdom); the
    // point of this smoke is that ChartContainer + AreaChart mount cleanly.
    const { container } = render(
      <ViewsTrendChart
        data={[
          { date: "2026-07-01", value: 3 },
          { date: "2026-07-02", value: 5 },
        ]}
      />,
    );
    expect(container.querySelector("[data-chart]")).toBeTruthy();
  });
});

describe("DateRangePicker", () => {
  it("mounts a combobox trigger", () => {
    render(<DateRangePicker value="30" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
