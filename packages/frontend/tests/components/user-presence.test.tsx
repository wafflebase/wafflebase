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
import {
  PRESENCE_AVATAR_SIZE,
  UserPresence,
} from "@/components/user-presence";

function renderPresence() {
  return render(
    <TooltipProvider>
      <UserPresence />
    </TooltipProvider>,
  );
}

/**
 * Every utility on an element that can set a width or height, reduced to the
 * ones that actually win.
 *
 * `size-N` needs handling rather than ignoring: `cn()` is `twMerge`, which
 * only lets `size-*` override a *preceding* `w-*`/`h-*`, not a following one.
 * shadcn's `Avatar` puts `size-8` in its base classes and `AvatarStack` passes
 * `h-N w-N` after it, so both survive the merge and reach the DOM together.
 * In the stylesheet Tailwind emits `h-*`/`w-*` after `size-*`, so the explicit
 * pair is what paints — which is why `size-N` contributes only on an axis
 * that has no explicit utility. Expanding it unconditionally would report a
 * phantom `h-8 w-8` on a `size={24}` stack and fail a correct component.
 */
function sizingTokens(element: Element): string[] {
  const classes = element.className.split(" ");
  const explicit = classes.filter((token) =>
    /^(?:min-|max-)?[wh]-|^basis-/.test(token),
  );
  const hasAxis = (axis: "w" | "h") =>
    explicit.some((token) => token.startsWith(`${axis}-`));

  const fromSize = classes.flatMap((token) => {
    const size = /^size-(.+)$/.exec(token);
    if (!size) return [];
    return (["h", "w"] as const)
      .filter((axis) => !hasAxis(axis))
      .map((axis) => `${axis}-${size[1]}`);
  });

  return [...new Set([...explicit, ...fromSize])].sort();
}

/**
 * Asserts the element is one avatar wide and tall — carrying those utilities
 * and *no others* that could set a width or height.
 *
 * Merely finding `w-8` in the list would pass for `"w-8 w-32"`, which paints
 * a 128px box: Tailwind settles a collision by stylesheet order, not by the
 * order the classes appear in the attribute. Reintroducing the original
 * placeholder alongside the new one is exactly the regression this file
 * exists to catch, so the assertion has to be exclusive.
 */
function expectSizedLikeOneAvatar(element: Element) {
  expect(sizingTokens(element)).toEqual(
    [...AVATAR_SIZE_CLASS[PRESENCE_AVATAR_SIZE].split(" ")].sort(),
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
