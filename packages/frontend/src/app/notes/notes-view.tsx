import { initialize, type NoteEditorAPI, type ThemeMode } from "@wafflebase/notes";
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

export type { NoteEditorAPI } from "@wafflebase/notes";

interface NotesViewProps {
  onEditorReady?: (editor: NoteEditorAPI | null) => void;
  readOnly?: boolean;
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
export function NotesView({ onEditorReady, readOnly }: NotesViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NoteEditorAPI | null>(null);
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

    const store = new YorkieNoteStore(doc);
    const theme = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
    const editor = initialize(container, store, theme, readOnly);
    editorRef.current = editor;
    onEditorReady?.(editor);

    return () => {
      editor.dispose();
      editorRef.current = null;
      onEditorReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didMount, doc]);

  // Update the editor theme when the user toggles light/dark mode.
  useEffect(() => {
    editorRef.current?.setTheme(
      (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode,
    );
  }, [resolvedTheme]);

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
