import { describe, expect, it } from "vitest";
import { buttonVariants } from "../button";
import { badgeVariants } from "../badge";

// A `/90` alpha hover lets the page show through, so the primary fill gets
// lighter on hover and drops under AA beneath its label. DESIGN.md says
// primary controls hover darker, to the `primary-hover` token.
describe("primary hover", () => {
  it("darkens the default Button to primary-hover", () => {
    const classes = buttonVariants({ variant: "default" });
    expect(classes).toContain("hover:bg-primary-hover");
    expect(classes).not.toMatch(/hover:bg-primary\/\d+/);
  });

  it("darkens the default Badge link to primary-hover", () => {
    const classes = badgeVariants({ variant: "default" });
    expect(classes).toContain("hover:bg-primary-hover");
    expect(classes).not.toMatch(/hover:bg-primary\/\d+/);
  });
});
