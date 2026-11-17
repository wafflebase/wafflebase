/**
 * The docs link popover's Apply guard (#1038).
 *
 * The popover deliberately survives the caret leaving the link it was
 * opened on — you can click into the body while it is open. Apply must
 * therefore re-check that the caret is still on *that* link before calling
 * `insertLink`, which would otherwise either insert the URL as plain text
 * wherever the caret went, or silently rewrite whichever other hyperlink
 * the caret landed in.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { DocsLinkPopover } from "@/app/docs/docs-link-popover";
import type { EditorAPI } from "@wafflebase/docs";

/**
 * A stub with a real "where is the caret" answer behind it, so the guard is
 * tested against the contract (`getLinkAtCursor`) rather than a constant.
 */
function makeEditor(hrefAtCursor: string | undefined) {
  let href = hrefAtCursor;
  const editor = {
    getLinkAtCursor: vi.fn(() => href),
    insertLink: vi.fn(),
    removeLink: vi.fn(),
    focus: vi.fn(),
    onCursorLinkChange: vi.fn(),
  };
  return {
    editor: editor as unknown as EditorAPI,
    calls: editor,
    /** Model the caret moving while the popover stays open. */
    moveCaretTo: (next: string | undefined) => {
      href = next;
    },
  };
}

const POSITION = { x: 10, y: 20, height: 16 };

function renderPopover(editor: EditorAPI, initialUrl: string) {
  const containerRef = createRef<HTMLDivElement>();
  (containerRef as { current: HTMLDivElement | null }).current =
    document.createElement("div");
  return render(
    <DocsLinkPopover
      editor={editor}
      containerRef={containerRef}
      editRequest={{ initialUrl, position: POSITION }}
      onEditRequestHandled={() => {}}
    />,
  );
}

function apply() {
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
}

function typeUrl(value: string) {
  fireEvent.change(screen.getByLabelText("Link URL"), { target: { value } });
}

describe("DocsLinkPopover Apply guard", () => {
  it("applies when the caret is still on the link it was opened for", () => {
    const { editor, calls } = makeEditor("https://example.com");
    renderPopover(editor, "https://example.com");

    typeUrl("https://example.org");
    apply();

    expect(calls.insertLink).toHaveBeenCalledWith("https://example.org");
  });

  it("refuses when the caret has left the link entirely", () => {
    const { editor, calls, moveCaretTo } = makeEditor("https://example.com");
    renderPopover(editor, "https://example.com");

    typeUrl("https://example.org");
    moveCaretTo(undefined); // clicked into plain body text
    apply();

    // Without the guard this inserts the URL as text at the new caret.
    expect(calls.insertLink).not.toHaveBeenCalled();
  });

  it("refuses when the caret moved into a *different* link", () => {
    const { editor, calls, moveCaretTo } = makeEditor("https://example.com");
    renderPopover(editor, "https://example.com");

    typeUrl("https://example.org");
    moveCaretTo("https://other.example.com");
    apply();

    // A presence-only check passes here and rewrites the other link.
    expect(calls.insertLink).not.toHaveBeenCalled();
  });

  it("keeps the typed URL and says why, rather than discarding it", () => {
    const { editor, moveCaretTo } = makeEditor("https://example.com");
    renderPopover(editor, "https://example.com");

    typeUrl("https://example.org");
    moveCaretTo(undefined);
    apply();

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText("Link URL")).toHaveValue(
      "https://example.org",
    );
  });

  it("clears the message once the URL is edited again", () => {
    const { editor, moveCaretTo } = makeEditor("https://example.com");
    renderPopover(editor, "https://example.com");

    typeUrl("https://example.org");
    moveCaretTo(undefined);
    apply();
    expect(screen.queryByRole("alert")).not.toBeNull();

    typeUrl("https://example.net");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not gate a fresh insert, where there is no link to leave", () => {
    // ⌘K with no link at the caret prefills nothing; the guard must stay
    // out of the way or the ordinary "add a link" flow is dead.
    const { editor, calls } = makeEditor(undefined);
    renderPopover(editor, "");

    typeUrl("https://example.org");
    apply();

    expect(calls.insertLink).toHaveBeenCalledWith("https://example.org");
  });
});

/**
 * On a 393px phone, a caret near the end of a line opened the popover with
 * its left edge past the middle of the screen and Apply off it. The
 * popover is measured after render and kept 8px inside the window.
 */
describe("DocsLinkPopover viewport clamp", () => {
  function withBox(width: number, height: number) {
    const w = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(width);
    const h = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(height);
    return () => {
      w.mockRestore();
      h.mockRestore();
    };
  }

  function popoverBox() {
    return screen.getByLabelText("Link URL").closest(".fixed") as HTMLElement;
  }

  function renderAt(position: { x: number; y: number; height: number }) {
    const { editor } = makeEditor(undefined);
    const containerRef = createRef<HTMLDivElement>();
    (containerRef as { current: HTMLDivElement | null }).current =
      document.createElement("div");
    render(
      <DocsLinkPopover
        editor={editor}
        containerRef={containerRef}
        editRequest={{ initialUrl: "", position }}
        onEditRequestHandled={() => {}}
      />,
    );
  }

  it("slides left so its right edge stays inside a narrow window", () => {
    vi.stubGlobal("innerWidth", 393);
    vi.stubGlobal("innerHeight", 659);
    const restore = withBox(280, 40);
    try {
      renderAt({ x: 300, y: 100, height: 16 });
      expect(popoverBox().style.left).toBe(`${393 - 280 - 8}px`);
      expect(popoverBox().style.top).toBe(`${100 + 16 + 4}px`);
    } finally {
      restore();
      vi.unstubAllGlobals();
    }
  });

  it("flips above the caret when there is no room below", () => {
    vi.stubGlobal("innerWidth", 393);
    vi.stubGlobal("innerHeight", 400);
    const restore = withBox(280, 40);
    try {
      renderAt({ x: 20, y: 370, height: 16 });
      expect(popoverBox().style.left).toBe("20px");
      expect(popoverBox().style.top).toBe(`${370 - 4 - 40}px`);
    } finally {
      restore();
      vi.unstubAllGlobals();
    }
  });
});
