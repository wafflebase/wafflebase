import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { contrastRatio } from "@wafflebase/core/tokens";
import { BOARD_PLANE_DIMMED_BACKGROUND } from "./board-plane";
import { BoardEmptyHint } from "./board-empty-hint";

let mobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));

function setCoarse(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: coarse)" ? coarse : false,
  })) as unknown as typeof window.matchMedia;
}

function renderHint(workspaceId?: string) {
  render(
    <MemoryRouter>
      <BoardEmptyHint workspaceId={workspaceId} />
    </MemoryRouter>,
  );
}

const templateLink = () => screen.getByRole("link", { name: "Start from a template" });

describe("BoardEmptyHint", () => {
  afterEach(() => {
    mobile = false;
  });

  it("links to the workspace's board templates", () => {
    setCoarse(false);
    renderHint("ws 1");
    expect(templateLink().getAttribute("href")).toBe(
      "/w/ws%201/templates?tab=public&type=board",
    );
  });

  it("links to the public gallery's board templates without a workspace", () => {
    setCoarse(false);
    renderHint();
    expect(templateLink().getAttribute("href")).toBe("/templates?type=board");
  });

  it("inks its text for the light plane, readable on the dimmed one too", () => {
    setCoarse(false);
    renderHint();
    const hint = screen.getByText(/right-click/).closest("p") as HTMLElement;
    // Fixed zinc-700 (5.48:1 on the dimmed #BBBCB8 plane), never a
    // theme-flipping class that would turn light in dark mode.
    expect(hint.className).not.toContain("text-muted-foreground");
    expect(contrastRatio(hint.style.color, BOARD_PLANE_DIMMED_BACKGROUND))
      .toBeGreaterThanOrEqual(4.5);
    // The link's words take the ink; the accent is only its underline.
    expect(contrastRatio(templateLink().style.color, BOARD_PLANE_DIMMED_BACKGROUND))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("names keys and right-click on a desktop", () => {
    setCoarse(false);
    renderHint();
    expect(screen.getByText(/right-click/)).toBeTruthy();
  });

  it("names the tool dock and long-press on a phone, and keeps the template link", () => {
    mobile = true;
    setCoarse(true);
    renderHint();
    expect(screen.queryByText(/right-click/)).toBeNull();
    expect(screen.getByText(/press\s+and hold/)).toBeTruthy();
    expect(templateLink()).toBeTruthy();
  });
});
