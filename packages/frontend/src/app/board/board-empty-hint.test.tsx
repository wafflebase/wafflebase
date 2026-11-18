import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
