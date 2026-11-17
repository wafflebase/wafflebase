import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardEmptyHint } from "./board-empty-hint";

let mobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));

function setCoarse(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: coarse)" ? coarse : false,
  })) as unknown as typeof window.matchMedia;
}

describe("BoardEmptyHint", () => {
  afterEach(() => {
    mobile = false;
  });

  it("names keys and right-click on a desktop", () => {
    setCoarse(false);
    render(<BoardEmptyHint />);
    expect(screen.getByText(/right-click/)).toBeTruthy();
  });

  it("names the + button and long-press on a phone", () => {
    mobile = true;
    setCoarse(true);
    render(<BoardEmptyHint />);
    expect(screen.queryByText(/right-click/)).toBeNull();
    expect(screen.getByText(/press\s+and hold/)).toBeTruthy();
  });
});
