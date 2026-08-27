/**
 * `NotesToolbar` mobile layout.
 *
 * The toolbar renders 18 controls and its `Toolbar` root is `overflow-x-auto`,
 * so on a phone nothing was clipped — the strip scrolled sideways instead, and
 * the `ml-auto` view-mode / keymap group was pushed past the right edge. These
 * tests pin the fix: below the mobile breakpoint the list and insert controls
 * leave the strip for an overflow menu, and `Split` (a fixed 50/50 pane layout,
 * ~187px per pane on a 375px screen) is not offered.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NoteEditorAPI, NoteInlineFormats } from "@wafflebase/notes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotesToolbar } from "./notes-toolbar";

// jsdom ships no matchMedia; `useIsMobile()` subscribes to it and then reads
// `window.innerWidth` for the actual value, so the width is what each test
// varies. jsdom defaults to 1024 (desktop).
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

const FORMATS: NoteInlineFormats = {
  bold: false,
  italic: false,
  strikethrough: false,
  link: false,
  list: null,
  canIndent: true,
  canOutdent: true,
};

/** Smallest editor that leaves every toolbar control enabled and clickable. */
function stubEditor(): NoteEditorAPI {
  return {
    getActiveFormats: () => FORMATS,
    onSelectionChange: () => {},
    canUndo: () => true,
    canRedo: () => true,
    canInsertImage: () => true,
    undo: vi.fn(),
    redo: vi.fn(),
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    toggleStrikethrough: vi.fn(),
    toggleLink: vi.fn(),
    toggleQuote: vi.fn(),
    insertCodeBlock: vi.fn(),
    insertFoldout: vi.fn(),
    insertTable: vi.fn(),
    toggleBulletList: vi.fn(),
    toggleOrderedList: vi.fn(),
    toggleTaskList: vi.fn(),
    indentList: vi.fn(),
    outdentList: vi.fn(),
    insertImageFiles: vi.fn(),
    focus: vi.fn(),
  } as unknown as NoteEditorAPI;
}

function renderToolbar(editor: NoteEditorAPI, onModeChange = vi.fn()) {
  render(
    <TooltipProvider>
      <NotesToolbar
        mode="edit"
        onModeChange={onModeChange}
        keymap="default"
        onKeymapChange={vi.fn()}
        showAuthors={false}
        onShowAuthorsChange={vi.fn()}
        editor={editor}
      />
    </TooltipProvider>,
  );
  return { onModeChange };
}

/** The toolbar strip itself, excluding anything Radix portals out of it. */
function strip() {
  return screen.getByRole("toolbar", { name: "Note toolbar" });
}

// Controls that stay inline at every width, and the ones that move.
const ALWAYS_INLINE = ["Undo", "Redo", "Bold", "Italic", "Strikethrough"];
const MOVES_TO_MENU = [
  "Bullet list",
  "Numbered list",
  "Checkbox",
  "Indent",
  "Outdent",
  "Link",
  "Quote",
  "Code block",
  "Foldout",
];

beforeEach(() => {
  setViewportWidth(1024);
});

describe("NotesToolbar on a desktop viewport", () => {
  it("keeps every formatting control inline", () => {
    renderToolbar(stubEditor());
    for (const label of [...ALWAYS_INLINE, ...MOVES_TO_MENU]) {
      expect(
        within(strip()).getByRole("button", { name: label }),
      ).toBeDefined();
    }
    expect(
      within(strip()).getByRole("button", { name: "Insert table" }),
    ).toBeDefined();
    expect(
      within(strip()).getByRole("button", { name: "Insert image" }),
    ).toBeDefined();
  });

  it("offers no overflow menu", () => {
    renderToolbar(stubEditor());
    expect(
      within(strip()).queryByRole("button", {
        name: "More formatting options",
      }),
    ).toBeNull();
  });

  it("offers Split in the view-mode menu", async () => {
    const user = userEvent.setup();
    renderToolbar(stubEditor());
    await user.click(screen.getByRole("button", { name: /^View mode:/ }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Split" }),
    ).toBeDefined();
  });
});

describe("NotesToolbar on a phone viewport", () => {
  beforeEach(() => {
    setViewportWidth(375);
  });

  it("keeps undo/redo and the inline text formats in the strip", () => {
    renderToolbar(stubEditor());
    for (const label of ALWAYS_INLINE) {
      expect(
        within(strip()).getByRole("button", { name: label }),
      ).toBeDefined();
    }
  });

  it("moves the list and insert controls out of the strip", () => {
    renderToolbar(stubEditor());
    for (const label of [...MOVES_TO_MENU, "Insert table", "Insert image"]) {
      expect(within(strip()).queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("exposes the moved controls in the overflow menu", async () => {
    const user = userEvent.setup();
    const editor = stubEditor();
    renderToolbar(editor);

    await user.click(
      within(strip()).getByRole("button", { name: "More formatting options" }),
    );

    // The three list kinds are toggles, so they render as checkbox items.
    for (const label of ["Bullet list", "Numbered list", "Checkbox", "Link"]) {
      expect(
        screen.getByRole("menuitemcheckbox", { name: label }),
      ).toBeDefined();
    }
    for (const label of [
      "Indent",
      "Outdent",
      "Quote",
      "Code block",
      "Foldout",
      "Table (3×3)",
      "Image",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeDefined();
    }
  });

  it("drives the editor from an overflow menu item", async () => {
    const user = userEvent.setup();
    const editor = stubEditor();
    renderToolbar(editor);

    await user.click(
      within(strip()).getByRole("button", { name: "More formatting options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Quote" }));

    expect(editor.toggleQuote).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the editor when the overflow menu closes", async () => {
    // Radix's default is to focus the trigger again, which on a phone drops
    // the soft keyboard immediately after a formatting change.
    const user = userEvent.setup();
    const editor = stubEditor();
    renderToolbar(editor);

    await user.click(
      within(strip()).getByRole("button", { name: "More formatting options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Quote" }));

    expect(editor.focus).toHaveBeenCalled();
  });

  it("inserts a 3×3 table from the overflow menu", async () => {
    const user = userEvent.setup();
    const editor = stubEditor();
    renderToolbar(editor);

    await user.click(
      within(strip()).getByRole("button", { name: "More formatting options" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Table (3×3)" }));

    expect(editor.insertTable).toHaveBeenCalledWith(3, 3);
  });

  it("does not report a mode change when the active mode is re-picked", async () => {
    // `mode` here is the *effective* mode, so on a phone a stored `both`
    // arrives as `edit`. Reporting `edit` back would persist the demotion and
    // destroy the user's desktop Split preference on a tap that changed
    // nothing — Radix fires onCheckedChange for the checked item too.
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    renderToolbar(stubEditor(), onModeChange);

    await user.click(screen.getByRole("button", { name: /^View mode:/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Editor" }));

    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("reports a real mode change", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    renderToolbar(stubEditor(), onModeChange);

    await user.click(screen.getByRole("button", { name: /^View mode:/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Preview" }));

    expect(onModeChange).toHaveBeenCalledWith("view");
  });

  it("does not offer Split in the view-mode menu", async () => {
    const user = userEvent.setup();
    renderToolbar(stubEditor());

    await user.click(screen.getByRole("button", { name: /^View mode:/ }));

    expect(
      screen.getByRole("menuitemcheckbox", { name: "Editor" }),
    ).toBeDefined();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Preview" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Split" }),
    ).toBeNull();
  });
});
