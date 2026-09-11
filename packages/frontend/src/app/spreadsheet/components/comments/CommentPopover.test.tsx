import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Thread } from "@wafflebase/sheets";
import { CommentPopover } from "./CommentPopover";

/**
 * The popover's `readOnly` prop, added because being *signed in* is not
 * authority over somebody else's document. Before it, the write affordances
 * were hidden only for an anonymous visitor (`currentUser === null`), so a
 * signed-in non-member on a viewer-role share link got the whole compose /
 * reply / resolve / edit / delete UI — and every one of those buttons is a
 * `doc.update()` on the CRDT root, which the auth webhook refuses and which
 * takes the viewer's own sync down with it.
 *
 * These assert the two things the prop has to keep true: nothing writable is
 * rendered, and the explanation names the *reason* (view-only access, not
 * "sign in") so a signed-in viewer is not told to do something that would not
 * help.
 */
const author = { userId: "u1", username: "alice" };
const other = { userId: "u2", username: "bob" };

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "t1",
    anchor: { kind: "sheet-cell", tabId: "tab1", rowId: "r1", colId: "c1" },
    comments: [
      {
        id: "c1",
        author,
        body: "first",
        createdAt: 1_700_000_000_000,
      },
    ],
    resolved: false,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const handlers = () => ({
  onAddThread: vi.fn().mockResolvedValue(undefined),
  onReply: vi.fn().mockResolvedValue(undefined),
  onResolve: vi.fn().mockResolvedValue(undefined),
  onEditComment: vi.fn().mockResolvedValue(undefined),
  onDeleteComment: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
});

describe("CommentPopover read-only", () => {
  it("renders no write affordance for a signed-in viewer", () => {
    render(
      <CommentPopover
        threads={[thread()]}
        currentUser={author}
        readOnly
        {...handlers()}
      />,
    );

    // The thread itself is readable — a viewer is here to read it.
    expect(screen.getByText("first")).toBeTruthy();
    // Every write control is gone: the reply composer, the resolve icon, and
    // the "more" menu that holds Edit / Delete.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("renders those affordances for a signed-in editor", () => {
    render(
      <CommentPopover threads={[thread()]} currentUser={author} {...handlers()} />,
    );

    // Same author as the comment, so Edit / Delete are reachable too — this is
    // the case the `readOnly` prop has to differ from.
    expect(screen.getByRole("button", { name: "Resolve thread" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("offers no composer on an uncommented cell, and says why", () => {
    render(
      <CommentPopover threads={[]} currentUser={author} readOnly {...handlers()} />,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
    // Not "Sign in to leave a comment" — this visitor *is* signed in, and
    // signing in again would not get them write access.
    expect(
      screen.getByText("You have view-only access to this document."),
    ).toBeTruthy();
  });

  it("still tells an anonymous visitor to sign in", () => {
    render(
      <CommentPopover threads={[]} currentUser={null} {...handlers()} />,
    );

    expect(screen.getByText("Sign in to leave a comment.")).toBeTruthy();
  });

  it("hides another user's Edit / Delete without hiding the reply box", () => {
    render(
      <CommentPopover threads={[thread()]} currentUser={other} {...handlers()} />,
    );

    // A writable mount for a different user: they may reply and resolve, but
    // not edit somebody else's comment. This is the pre-existing rule the
    // `readOnly` prop sits on top of rather than replaces.
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Resolve thread" })).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
