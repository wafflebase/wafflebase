import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { NoteEditorAPI, NoteKeymap, NoteViewMode } from "@wafflebase/notes";
import type { ResolvedShareLink } from "@/api/share-links";
import { SharedHeaderStatus } from "@/app/shared/shared-header-status";
import { UserPresence } from "@/components/user-presence";
import { NotesView } from "@/app/notes/notes-view";
import {
  readKeymap,
  readShowAuthors,
  readViewMode,
} from "@/app/notes/notes-settings";
import { shareTokenImageUploader } from "@/app/docs/image-insert";
import { useIsMobile } from "@/hooks/use-mobile";

// The notes toolbar pulls the shared toolbar/dropdown primitives and ~20
// tabler icons. Lazy-load it for the same reason `shared-document.tsx` does
// with `SlidesToolbar`: a share link to another document type shouldn't pay
// for it, and neither should a note share link until this layout mounts.
const NotesToolbar = lazy(() =>
  import("@/app/notes/notes-toolbar").then((module) => ({
    default: module.NotesToolbar,
  })),
);

/**
 * Shared notes layout — the same `NotesView` + `NotesToolbar` pair the
 * workspace route mounts (`app/notes/notes-detail.tsx`), so a share-link
 * visitor gets the view menu, undo/redo, the formatting group, the keymap
 * picker and image upload rather than a bare editor. Notes used to be the one
 * editable type whose two entry paths differed here (issue #1044).
 *
 * The state is the workspace route's, minus every `localStorage` **write**:
 * the per-browser preferences are read once as initial values so a visitor's
 * own vim keymap and blame gutter still apply, but nothing they change behind
 * an anonymous share link is persisted back over them.
 */
export function SharedNotesLayout({
  resolved,
  token,
}: {
  resolved: ResolvedShareLink;
  token?: string;
}) {
  const readOnly = resolved.role === "viewer";
  const [editor, setEditor] = useState<NoteEditorAPI | null>(null);
  // A viewer opens on the rendered markdown; the view menu is what lets them
  // reach the source from there. An editor gets whatever mode they last chose
  // in a surface that does persist one.
  const [viewMode, setViewMode] = useState<NoteViewMode>(() =>
    readOnly ? "view" : readViewMode(),
  );
  const [keymap, setKeymap] = useState<NoteKeymap>(readKeymap);
  const [showAuthors, setShowAuthors] = useState<boolean>(readShowAuthors);
  const isMobile = useIsMobile();

  // Split is a fixed 50/50 pane layout (`packages/notes` `editor.ts`), so on a
  // 375px phone it is two ~187px panes. The toolbar stops offering the mode
  // below the breakpoint, so demote a stored `both` for the render only —
  // exactly as `notes-detail` does. Now that this route has a view menu the
  // demotion is reversible, which is what previously ruled it out here.
  const effectiveViewMode: NoteViewMode =
    isMobile && viewMode === "both" ? "edit" : viewMode;

  // An anonymous visitor has no session, so the authenticated uploader's
  // `POST /images` is a 401 — and `fetchWithAuth` reads that 401 as an expired
  // session, logs them out and navigates to `/login`, losing the note they
  // were editing. Upload through the share token instead — the backend refuses
  // a viewer-role token, so skipping it for `readOnly` only saves a request
  // that would be denied; `NotesView` leaves the upload extension out of a
  // read-only mount either way. The read half is already wired:
  // `shared-document.tsx` installs the notes engine's share-token image-URL
  // resolver for this mount.
  const uploadImage = useMemo(
    () => (token && !readOnly ? shareTokenImageUploader(token) : undefined),
    [token, readOnly],
  );

  useEffect(() => {
    document.title = resolved.title
      ? `${resolved.title} — Wafflebase`
      : "Wafflebase";
  }, [resolved.title]);

  const handleModeChange = useCallback((next: NoteViewMode) => {
    setViewMode(next);
  }, []);

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-medium">{resolved.title}</h1>
          <SharedHeaderStatus readOnly={readOnly} />
        </div>
        <UserPresence />
      </header>
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {/*
          Mounted for a viewer too: `canFormat = !readOnly && mode !== "view"`
          drops the formatting group on its own, leaving the view menu — which
          is the whole point of the toolbar on a read-only mount. The "View
          only" badge still comes from `SharedHeaderStatus`.
        */}
        <Suspense fallback={null}>
          <NotesToolbar
            mode={effectiveViewMode}
            onModeChange={handleModeChange}
            keymap={keymap}
            onKeymapChange={setKeymap}
            showAuthors={showAuthors}
            onShowAuthorsChange={setShowAuthors}
            editor={editor}
            readOnly={readOnly}
          />
        </Suspense>
        <NotesView
          onEditorReady={setEditor}
          readOnly={readOnly}
          viewMode={effectiveViewMode}
          keymap={keymap}
          showAuthors={showAuthors}
          uploadImage={uploadImage}
        />
      </div>
    </div>
  );
}

export default SharedNotesLayout;
