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
  });

  it("shows an externally driven import's own progress wording", () => {
    // A file upload has a done/total fraction; an import's early stages have a
    // running count with no denominator, and a bare spinner reads as hung.
    const id = q.enqueueExternal({ fileName: "Miro board", kind: "board" });
    q.patchItem(id, {
      status: "parsing",
      done: 1250,
      total: 0,
      detail: "Reading board… 1,250 items",
    });
    render(<MemoryRouter><UploadPanel /></MemoryRouter>);

    expect(screen.getByText("Miro board")).toBeTruthy();
    expect(screen.getByText("Reading board… 1,250 items")).toBeTruthy();
  });

  it("offers no retry control for a failed row it cannot replay", () => {
    // Retrying a Miro import would need the access token, which is
    // deliberately never kept. A button that cannot work is worse than none —
    // so the row says what the user has to do instead.
    const id = q.enqueueExternal({ fileName: "Miro board", kind: "board" });
    q.patchItem(id, { status: "error", reason: "Miro rate limit reached" });
    render(<MemoryRouter><UploadPanel /></MemoryRouter>);

    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.getByText(/Miro rate limit reached/)).toBeTruthy();
    expect(screen.getByText(/start the import again/i)).toBeTruthy();
  });

  it("keeps the retry control for a failed file upload", () => {
    const [item] = q.enqueue([new File([new Uint8Array([1])], "deck.pptx")]);
    q.patchItem(item.id, { status: "error", reason: "network died" });
    render(<MemoryRouter><UploadPanel /></MemoryRouter>);

    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
