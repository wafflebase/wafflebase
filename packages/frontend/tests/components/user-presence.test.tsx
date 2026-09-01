/**
 * The presence slot sits in the header's right-hand control cluster, which is
 * `shrink-0` and therefore right-anchored: whatever width this slot takes, the
 * Share / comments / sync controls to its left are pushed by exactly that
 * much.
 *
 * A Yorkie document attaches asynchronously, so every document open renders
 * this component at least twice — once with no presences, then with the user's
 * own. If the two states are not the same width, the whole header visibly
 * jolts on open. These tests pin the reservation to one avatar, which is the
 * floor of the attached state (you are always in your own presence list).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const presences = vi.hoisted(() => ({
  current: [] as Array<{ clientID: string; presence: Record<string, unknown> }>,
}));

vi.mock("@yorkie-js/react", () => ({
  useDocument: () => ({ doc: { getOthersPresences: () => [] } }),
  usePresences: () => presences.current,
}));
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@wafflebase/sheets", () => ({
  getPeerCursorColor: () => "#000000",
}));

import { AVATAR_SIZE_CLASS } from "@/components/avatar-size";
import { UserPresence } from "@/components/user-presence";

function renderPresence() {
  return render(
    <TooltipProvider>
      <UserPresence />
    </TooltipProvider>,
  );
}

/**
 * Every width/height utility on an element, with `size-N` expanded to the
 * pair it stands for and duplicates collapsed.
 */
function sizingTokens(element: Element): string[] {
  const tokens = element.className.split(" ").flatMap((token) => {
    const size = /^size-(.+)$/.exec(token);
    if (size) return [`h-${size[1]}`, `w-${size[1]}`];
    return /^[wh]-/.test(token) ? [token] : [];
  });
  return [...new Set(tokens)].sort();
}

/**
 * Asserts the element is one avatar wide and tall — carrying those utilities
 * and *no others* that set a width or height.
 *
 * Merely finding `w-8` in the list would pass for `"w-8 w-32"`, which paints
 * a 128px box: Tailwind settles a collision by stylesheet order, not by the
 * order the classes appear in the attribute. Reintroducing the original
 * placeholder alongside the new one is exactly the regression this file
 * exists to catch, so the assertion has to be exclusive.
 */
function expectSizedLikeOneAvatar(element: Element) {
  expect(sizingTokens(element)).toEqual(
    [...AVATAR_SIZE_CLASS[32].split(" ")].sort(),
  );
}

describe("UserPresence layout reservation", () => {
  it("reserves exactly one avatar before the document attaches", () => {
    presences.current = [];
    renderPresence();

    expectSizedLikeOneAvatar(screen.getByTestId("presence-placeholder"));
  });

  it("renders the attached solo state at that same reserved size", () => {
    presences.current = [
      { clientID: "c1", presence: { username: "Alice" } },
    ];
    const { container } = renderPresence();

    expect(screen.queryByTestId("presence-placeholder")).toBeNull();
    const avatar = container.querySelector('[data-slot="avatar"]');
    expect(avatar).not.toBeNull();
    expectSizedLikeOneAvatar(avatar!);
  });
});
