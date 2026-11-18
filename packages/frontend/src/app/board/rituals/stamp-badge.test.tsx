import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Toggle } from "@/components/ui/toggle";
import { stampIconRatio } from "./stamp-art";
import { StampBadge, StampGlyph } from "./stamp-badge";

describe("StampBadge", () => {
  it("sizes its icon by style, which a host's [&_svg]:size-4 rule cannot override", () => {
    // Toggle carries `[&_svg:not([class*='size-'])]:size-4`; SVG width/height
    // attributes lose to it, an inline style does not.
    const { container } = render(
      <Toggle aria-label="Stamp">
        <StampBadge kind="star" size={18} />
      </Toggle>,
    );
    const svg = container.querySelector("[data-stamp-badge] svg") as SVGSVGElement;
    // Menu-sized (<24px), so the small-badge boost applies.
    const icon = `${Math.round(18 * stampIconRatio("star") * 1.25)}px`;
    expect(svg.style.width).toBe(icon);
    expect(svg.style.height).toBe(icon);
    expect(svg.getAttribute("stroke-width")).toBe("2");
  });
});

describe("StampGlyph", () => {
  it("draws every path as a 16px currentColor outline", () => {
    const { container } = render(<StampGlyph kind="heart" />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.getAttribute("class")).toContain("size-4");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("2");
    for (const path of svg.querySelectorAll("path")) {
      expect(path.getAttribute("fill")).toBeNull();
    }
  });
});
