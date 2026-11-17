import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BoardEmptyHint } from "./board-empty-hint";

function linkFor(workspaceId?: string) {
  render(
    <MemoryRouter>
      <BoardEmptyHint workspaceId={workspaceId} />
    </MemoryRouter>,
  );
  return screen.getByRole("link", { name: "Start from a template" });
}

describe("BoardEmptyHint", () => {
  it("links to the workspace's board templates", () => {
    expect(linkFor("ws 1").getAttribute("href")).toBe(
      "/w/ws%201/templates?tab=public&type=board",
    );
  });

  it("links to the public gallery's board templates without a workspace", () => {
    expect(linkFor().getAttribute("href")).toBe("/templates?type=board");
  });
});
