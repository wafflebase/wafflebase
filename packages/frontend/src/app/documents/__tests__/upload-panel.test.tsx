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
    // getByText already throws if no match is found, so toBeTruthy() gives
    // the same assertion strength as toBeInTheDocument().
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

  it("surfaces a warning on a row that succeeded, without reading as a failure", () => {
    // The toast is transient; the panel row is the durable surface. A
    // truncated import that shows a bare "Open" link reads as unqualified
    // success.
    const [item] = q.enqueue([new File([new Uint8Array([1])], "rows.csv")]);
    q.patchItem(item.id, {
      status: "done",
      docPath: "/d/abc",
      warning: "Only the first 5,000 rows were imported.",
    });
    render(<MemoryRouter><UploadPanel /></MemoryRouter>);

    const line = screen
      .getByText(/Only the first 5,000 rows were imported\./)
      .closest("p");
    expect(line).toBeTruthy();
    // The document exists, so the row keeps its link to it.
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    // A warned item did not fail — it must not borrow the error styling.
    // `not.toContain` alone would pass on an empty class list, so pin the
    // class that has to be there as well: the row goes through the
    // `--warning` semantic token, not a raw `text-amber-700 dark:text-amber-500`
    // pair (the one palette literal left in `packages/frontend/src` until
    // this change).
    expect(line!.className).toContain("text-warning");
    expect(line!.className).not.toContain("destructive");
  });

  it("shows no warning line on a clean success", () => {
    const [item] = q.enqueue([new File([new Uint8Array([1])], "rows.csv")]);
    q.patchItem(item.id, { status: "done", docPath: "/d/abc" });
    const { container } = render(<MemoryRouter><UploadPanel /></MemoryRouter>);

    expect(container.querySelectorAll("li p")).toHaveLength(0);
  });

  it("keeps the retry control for a failed file upload", () => {
    const [item] = q.enqueue([new File([new Uint8Array([1])], "deck.pptx")]);
    q.patchItem(item.id, { status: "error", reason: "network died" });
    render(<MemoryRouter><UploadPanel /></MemoryRouter>);

    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
