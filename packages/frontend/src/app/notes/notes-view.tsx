import {
  initialize,
  readOnlyNoteStore,
  type NoteStore,
  type NoteEditorAPI,
  type ThemeMode,
  type NoteViewMode,
  type NoteKeymap,
  type UploadImage,
} from "@wafflebase/notes";
import { useEffect, useRef, useState } from "react";
// `Text` is imported from @yorkie-js/react (NOT @yorkie-js/sdk) on purpose: the
// provider's client.attach recognizes CRDT values via `instanceof` against its
// own Text class, so content must be created from this same module or it is
// materialized as a plain `{ context, text }` object. See notes-document.ts.
import { useDocument, Text } from "@yorkie-js/react";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { YorkieNotesRoot, NotesPresence } from "@/types/notes-document";
import { YorkieNoteStore } from "./yorkie-note-store";
import {
  NOTE_THUMBNAIL_THEMES,
  renderNoteThumbnail,
} from "./notes-thumbnail";
import { registerThumbnailSource } from "@/lib/thumbnail-capture";
import { readShowAuthors } from "./notes-settings";

export type { NoteEditorAPI } from "@wafflebase/notes";

interface NotesViewProps {
  onEditorReady?: (editor: NoteEditorAPI | null) => void;
  readOnly?: boolean;
  /** Pane layout: editor only / split / preview only. Defaults to `both`. */
  viewMode?: NoteViewMode;
  /** Editor keybinding mode. Defaults to `default`. */
  keymap?: NoteKeymap;
  /**
   * Show the blame gutter (who last edited each line). Display only — every
   * client records authorship regardless, so what one reader sees does not
   * depend on what the writers had switched on. Omitted, it falls back to the
   * viewer's own stored preference — the same value both mounting routes seed
   * their own state from. Both of them do pass it (each owns a view menu), so
   * the fallback is unreached today; it is kept so that adding a third mount
   * cannot silently turn the gutter off for a reader who has it on. Note the
   * revision preview is not such a mount: it calls the notes engine's
   * `initialize()` directly (`components/history/revision-preview.tsx`) and
   * never renders this component.
   */
  showAuthors?: boolean;
  /**
   * Upload a pasted/dropped/picked image and resolve with its URL, or `null`
   * if the upload failed and was already reported to the user. Omitted on
   * read-only mounts.
   */
  uploadImage?: UploadImage;
  /**
   * Enables the template gallery's thumbnail source for this note. Optional
   * for the same reason it is on the other views: an anonymous share-link
   * mount has no document id to key one on, and no way to publish anyway.
   */
  documentId?: string;
}

/**
 * Ensure the Yorkie document has a valid `Text` CRDT at `root.content`.
 *
 * New notes receive the Text via `client.attach({ initialRoot })`. This helper
 * is a fallback/repair for documents whose content is missing OR was persisted
 * as a plain `{ context, text }` object by an earlier build that created the
 * Text from the wrong package instance (`@yorkie-js/sdk` vs `@yorkie-js/react`
 * class-identity mismatch). A valid Text exposes `edit()`; a mis-built
 * CRDTObject does not. After (re)creating we `clearHistory()` so an undo can't
 * unwind the seed. Caller must only invoke this on a writable (non-read-only)
 * document.
 */
function ensureText(
  doc: ReturnType<typeof useDocument<YorkieNotesRoot, NotesPresence>>["doc"],
): boolean {
  if (!doc) return false;
  const root = doc.getRoot();
  if (
    root.content &&
    typeof (root.content as { edit?: unknown }).edit === "function"
  ) {
    return true;
  }
  doc.update((r) => {
    r.content = new Text();
  });
  doc.clearHistory();
  return true;
}

/**
 * NotesView mounts the CodeMirror-based markdown note editor inside a
 * Yorkie DocumentProvider context. It creates a YorkieNoteStore and calls
 * `initialize(container, store, theme, readOnly)`. Remote changes and peer
 * carets are handled inside the engine via the store's subscriptions, so
 * (unlike DocsView) this component needs no re-render plumbing beyond
 * mount/unmount and theme sync.
 */
export function NotesView({
  onEditorReady,
  readOnly,
  viewMode = "both",
  keymap = "default",
  showAuthors,
  uploadImage,
  documentId,
}: NotesViewProps) {
  // A mount that does not own a view menu still honours the preference the
  // user set in one that does — same per-browser key, read once.
  const [storedShowAuthors] = useState(readShowAuthors);
  const gutterOn = showAuthors ?? storedShowAuthors;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NoteEditorAPI | null>(null);
  // `NoteStore`, not `YorkieNoteStore`: on a read-only mount this holds the
  // write-neutered view of it (see the effect below), and the only thing read
  // through it here is `getText()` for the thumbnail.
  const storeRef = useRef<NoteStore | null>(null);
  // The editor is initialized once (see the [didMount, doc] effect below), but
  // `uploadImage` changes identity as the document query resolves the
  // workspace id. Reading it through a ref hands the engine a stable callback
  // that always calls the current one, instead of remounting the editor —
  // which would drop the caret, scroll position, and any in-flight upload.
  const uploadRef = useRef(uploadImage);
  uploadRef.current = uploadImage;
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieNotesRoot, NotesPresence>();
  const { resolvedTheme } = useTheme();

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) return;

    // Repair/seed content on writable docs only (a read-only share viewer has
    // no write permission — the auth webhook would reject the update).
    if (!readOnly) ensureText(doc);

    // A viewer mount holds a WRITE-NEUTERED handle, not the raw CRDT store.
    // The editor's read-only mode stops typing and (via `EditorState.readOnly`
    // plus a remote-only `changeFilter`) every CodeMirror transaction, but a
    // store handle reaches around all of that — `editText`, `batch`, `undo`
    // and the presence publish are `doc.update` calls that pass through no
    // transaction at all. `readOnlyNoteStore` closes that at the store, the
    // same boundary `readOnlyDocStore` is for docs, so nothing this component
    // (or the engine) can be handed is a writable handle on a viewer mount.
    // `initialize()` wraps too and the wrapper is idempotent, so the guarantee
    // does not depend on which of the two remembers.
    const raw = new YorkieNoteStore(doc);
    const store = readOnly ? readOnlyNoteStore(raw) : raw;
    storeRef.current = store;
    const theme = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
    const editor = initialize(container, store, theme, readOnly, viewMode, {
      showAuthors: gutterOn,
      uploadImage: uploadRef.current
        ? (file) => uploadRef.current!(file)
        : undefined,
    });
    editorRef.current = editor;
    // keymap is not an initialize() param, so apply the persisted preference
    // now — otherwise re-opening with Vim set reverts to the default keymap.
    editor.setKeymap(keymap);
    onEditorReady?.(editor);

    return () => {
      editor.dispose();
      editorRef.current = null;
      storeRef.current = null;
      onEditorReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didMount, doc]);

  // Let the template gallery show a note as something other than an icon
  // (docs/design/template-gallery.md). Notes is the one DOM editor, so there
  // is no canvas to photograph — `renderNoteThumbnail` draws the markdown
  // itself. Registered here because only the view holds the store.
  useEffect(() => {
    if (!documentId) return;
    return registerThumbnailSource(documentId, () => {
      const text = storeRef.current?.getText();
      return text
        ? renderNoteThumbnail(
            text,
            NOTE_THUMBNAIL_THEMES[resolvedTheme === "dark" ? "dark" : "light"],
          )
        : null;
    });
  }, [documentId, resolvedTheme]);

  // Update the editor theme when the user toggles light/dark mode.
  useEffect(() => {
    editorRef.current?.setTheme(
      (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode,
    );
  }, [resolvedTheme]);

  // Apply view-mode changes from the toolbar to the mounted editor.
  useEffect(() => {
    editorRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  // Apply keybinding-mode changes (default / vim) to the mounted editor.
  useEffect(() => {
    editorRef.current?.setKeymap(keymap);
  }, [keymap]);

  // Show/hide the blame gutter from the view menu. Display only — the store
  // records authorship whether or not anyone is looking at the gutter.
  useEffect(() => {
    editorRef.current?.setShowAuthors(gutterOn);
  }, [gutterOn]);

  if (loading) return <Loader />;
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Failed to load note.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 w-full min-h-0 overflow-hidden"
    />
  );
}

export default NotesView;
