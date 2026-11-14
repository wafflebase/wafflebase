import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Toolbar } from "../toolbar";
import { overflowEdges } from "../use-overflow-edges";

describe("overflowEdges", () => {
  it("reports no edge when the content fits", () => {
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toBeNull();
  });

  it("reports the end at the start of a strip that overflows", () => {
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 })).toBe("end");
  });

  it("reports both edges mid-scroll", () => {
    expect(overflowEdges({ scrollLeft: 100, scrollWidth: 500, clientWidth: 300 })).toBe("both");
  });

  it("reports the start once scrolled to the end, sub-pixel slack included", () => {
    expect(overflowEdges({ scrollLeft: 199.5, scrollWidth: 500, clientWidth: 300 })).toBe("start");
  });

  it("measures an RTL scroller by distance", () => {
    expect(overflowEdges({ scrollLeft: -100, scrollWidth: 500, clientWidth: 300 })).toBe("both");
  });
});

describe("Toolbar overflow cue", () => {
  const sized = (el: HTMLElement, scrollWidth: number, clientWidth: number) => {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  };

  it("marks a strip that overflows and follows its scroll", () => {
    const { container } = render(<Toolbar data-testid="tb">x</Toolbar>);
    const el = container.firstElementChild as HTMLElement;
    // jsdom does no layout: fake an overflowing strip, then scroll it.
    sized(el, 500, 300);
    el.dispatchEvent(new Event("scroll"));
    expect(el.dataset.overflow).toBe("end");
    el.scrollLeft = 200;
    el.dispatchEvent(new Event("scroll"));
    expect(el.dataset.overflow).toBe("start");
    sized(el, 300, 300);
    el.scrollLeft = 0;
    el.dispatchEvent(new Event("scroll"));
    expect(el.dataset.overflow).toBeUndefined();
  });

  it("leaves a strip that fits unmarked and still forwards its ref", () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Toolbar ref={ref}>x</Toolbar>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.dataset.overflow).toBeUndefined();
  });
});
