import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as q from "@/app/documents/upload-queue";
import { UploadPanel } from "@/app/documents/upload-panel";

describe("UploadPanel", () => {
  beforeEach(() => q.__resetForTest());

  it("renders nothing when the queue is empty", () => {
    const { container } = render(<MemoryRouter><UploadPanel /></MemoryRouter>);
    expect(container.firstChild).toBeNull();
  });

  it("shows a row per file with its status", () => {
    q.enqueue([new File([new Uint8Array([1])], "deck.pptx"),
               new File([new Uint8Array([1])], "archive.zip")]);
    render(<MemoryRouter><UploadPanel /></MemoryRouter>);
    // No @testing-library/jest-dom in this repo (not installed anywhere in
    // the monorepo) — getByText already throws if no match is found, so
    // toBeTruthy() gives the same assertion strength as toBeInTheDocument().
    expect(screen.getByText("deck.pptx")).toBeTruthy();
    expect(screen.getByText("archive.zip")).toBeTruthy();
    expect(screen.getByText(/unsupported/i)).toBeTruthy();
  });
});
