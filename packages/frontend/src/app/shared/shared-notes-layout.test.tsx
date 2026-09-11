/**
 * `SharedNotesLayout` — the share-link note surface.
 *
 * It used to mount `NotesView` and nothing else, so an editor-role visitor got
 * no view menu, no undo/redo, no formatting and no image upload; on a phone
 * that meant a fixed 50/50 split (~187px panes) with no control that could
 * leave it (issue #1044). These tests pin the four things that fixed it: the
 * toolbar is mounted, a phone starts in `edit`, a viewer keeps the view menu
 * but loses the formatting group, and the share-token uploader reaches the
 * view — with nothing written back to the visitor's stored preferences.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NoteEditorAPI, NoteInlineFormats } from "@wafflebase/notes";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ResolvedShareLink } from "@/api/share-links";
import { SharedNotesLayout } from "./shared-notes-layout";

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

/**
 * The props the last `NotesView` render received. The real view mounts
 * CodeMirror against a live Yorkie document, so it is stubbed down to "report
 * an editor, record what you were handed" — which is exactly the wiring under
 * test here.
 */
const viewProps: { current: Record<string, unknown> } = { current: {} };

vi.mock("@/app/notes/notes-view", async () => {
  const { useEffect } = await import("react");
  return {
    NotesView: (props: Record<string, unknown>) => {
      viewProps.current = props;
      const onEditorReady = props.onEditorReady as
        | ((editor: NoteEditorAPI | null) => void)
        | undefined;
      // Reported from an effect, not the render body: the layout puts the
      // editor in state, and a state update during another component's render
      // is what React refuses.
      useEffect(() => {
        onEditorReady?.(stubEditor());
        return () => onEditorReady?.(null);
      }, [onEditorReady]);
      return <div data-testid="notes-view" />;
    },
  };
});

/** Set to make the stubbed share-token upload reject, as the real one does. */
const uploadFailure: { current: Error | null } = { current: null };

// The real uploader pulls the docs DOCX importer/exporter in through
// `docx-actions`; the layout only needs to hand *something* to the view.
vi.mock("@/app/docs/image-insert", () => ({
  shareTokenImageUploader: (token: string) => async () => {
    if (uploadFailure.current) throw uploadFailure.current;
    return `uploaded:${token}`;
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

// Both read the live Yorkie document through a provider this test has none of.
vi.mock("@/app/shared/shared-header-status", () => ({
  SharedHeaderStatus: ({ readOnly }: { readOnly: boolean }) => (
    <span>{readOnly ? "View only" : "Editing"}</span>
  ),
}));

vi.mock("@/components/user-presence", () => ({
  UserPresence: () => null,
}));

function resolvedLink(role: "editor" | "viewer"): ResolvedShareLink {
  return {
    documentId: "doc-1",
    title: "Release notes",
    type: "note",
    role,
  } as unknown as ResolvedShareLink;
}

async function renderLayout(role: "editor" | "viewer", token = "tok-1") {
  render(
    <TooltipProvider>
      <SharedNotesLayout resolved={resolvedLink(role)} token={token} />
    </TooltipProvider>,
  );
  // The toolbar is `lazy()`, so it lands one microtask after the first paint —
  // except on a cold transform cache, where the import has to put
  // `notes-toolbar` and its ~20 tabler icons through Vite first, which has
  // outlasted `findBy*`'s 1s default on two machines. The budget is a flake
  // guard, not a wait: a mounted toolbar still resolves immediately.
  return screen.findByRole(
    "toolbar",
    { name: "Note toolbar" },
    { timeout: 15_000 },
  );
}

beforeEach(() => {
  setViewportWidth(1024);
  window.localStorage.clear();
  viewProps.current = {};
  uploadFailure.current = null;
  toastError.mockClear();
});

describe("SharedNotesLayout for an editor-role visitor", () => {
  it("mounts the notes toolbar with its formatting group", async () => {
    const strip = await renderLayout("editor");
    for (const label of ["Undo", "Redo", "Bold", "Italic", "Strikethrough"]) {
      expect(within(strip).getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("hands the share-token uploader to the view", async () => {
    await renderLayout("editor");
    expect(typeof viewProps.current.uploadImage).toBe("function");
    await expect(
      (viewProps.current.uploadImage as () => Promise<string>)(),
    ).resolves.toBe("uploaded:tok-1");
  });

  // The notes engine's `UploadImage` contract is "resolve `null` once you have
  // told the user"; a rejection only reaches its `console.error`. The
  // share-token uploader rejects, so without an adapter here a failed upload
  // is the one mount that fails silently.
  it("reports a failed upload and resolves null", async () => {
    uploadFailure.current = new Error("413 too large");
    await renderLayout("editor");
    const upload = viewProps.current.uploadImage as (
      file: File,
    ) => Promise<string | null>;
    await expect(upload(new File([], "a.png"))).resolves.toBeNull();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("413 too large"),
    );
  });

  it("opens in the visitor's stored view mode", async () => {
    window.localStorage.setItem("wafflebase:notes:viewMode", "edit");
    await renderLayout("editor");
    expect(viewProps.current.viewMode).toBe("edit");
  });

  it("applies a view-mode change without persisting it", async () => {
    window.localStorage.setItem("wafflebase:notes:viewMode", "both");
    const user = userEvent.setup();
    await renderLayout("editor");
    expect(viewProps.current.viewMode).toBe("both");

    await user.click(screen.getByRole("button", { name: /^View mode:/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Preview" }));

    expect(viewProps.current.viewMode).toBe("view");
    // An anonymous visitor must not overwrite a per-browser preference.
    expect(window.localStorage.getItem("wafflebase:notes:viewMode")).toBe(
      "both",
    );
  });

  it("starts in edit mode on a phone rather than a 50/50 split", async () => {
    window.localStorage.setItem("wafflebase:notes:viewMode", "both");
    setViewportWidth(375);
    await renderLayout("editor");
    expect(viewProps.current.viewMode).toBe("edit");
  });

  // The layout's promise is "the workspace route's state, minus every
  // `localStorage` write" — so it holds for all three settings the toolbar
  // exposes, not just the view mode above. Each is read on mount and applied
  // when changed; none is written back.
  it("applies keymap and show-authors changes without persisting either", async () => {
    window.localStorage.setItem("wafflebase:notes:keymap", "default");
    window.localStorage.setItem("wafflebase:notes:showAuthors", "false");
    const user = userEvent.setup();
    await renderLayout("editor");
    expect(viewProps.current.keymap).toBe("default");
    expect(viewProps.current.showAuthors).toBe(false);

    await user.click(screen.getByRole("button", { name: /^Keyboard:/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Vim" }));
    expect(viewProps.current.keymap).toBe("vim");

    await user.click(screen.getByRole("button", { name: /^View mode:/ }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Show authors" }),
    );
    expect(viewProps.current.showAuthors).toBe(true);

    expect(window.localStorage.getItem("wafflebase:notes:keymap")).toBe(
      "default",
    );
    expect(window.localStorage.getItem("wafflebase:notes:showAuthors")).toBe(
      "false",
    );
  });
});

describe("SharedNotesLayout for a viewer-role visitor", () => {
  it("keeps the view menu but drops the formatting group", async () => {
    const strip = await renderLayout("viewer");
    expect(
      within(strip).getByRole("button", { name: /^View mode:/ }),
    ).toBeDefined();
    expect(within(strip).queryByRole("button", { name: "Bold" })).toBeNull();
    expect(within(strip).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("opens on the rendered markdown and gets no uploader", async () => {
    await renderLayout("viewer");
    expect(viewProps.current.viewMode).toBe("view");
    expect(viewProps.current.readOnly).toBe(true);
    expect(viewProps.current.uploadImage).toBeUndefined();
  });

  it("can reach the markdown source through the view menu", async () => {
    const user = userEvent.setup();
    await renderLayout("viewer");
    await user.click(screen.getByRole("button", { name: /^View mode:/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Editor" }));
    expect(viewProps.current.viewMode).toBe("edit");
  });
});
