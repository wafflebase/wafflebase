import type { NoteViewMode, NoteKeymap } from "@wafflebase/notes";

/**
 * Per-user (per-browser) notes editor preferences, persisted in localStorage.
 * These are USER settings, not document data — they must not live in the CRDT
 * or reset per note. The owner editor (NotesDetail) reads all three on open and
 * writes them on change.
 *
 * The share-link layout (`SharedNotesLayout`) reads the keymap and the blame
 * gutter on every mount — a visitor's own vim keymap and gutter setting apply
 * behind a share link too, on a viewer mount as much as an editor one. The
 * stored **view mode** is the one exception: a viewer opens on the rendered
 * markdown whatever they last chose, and reaches the source from the view menu
 * instead (`shared-notes-layout.tsx`), so on that mount only two of the three
 * are read.
 *
 * It writes none of them back: what an anonymous visitor changes behind a
 * share link must not overwrite the preferences they set in a surface that
 * owns them.
 */
const VIEW_MODE_KEY = "wafflebase:notes:viewMode";
const KEYMAP_KEY = "wafflebase:notes:keymap";
const SHOW_AUTHORS_KEY = "wafflebase:notes:showAuthors";

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures (private mode / disabled)
  }
}

export function readViewMode(): NoteViewMode {
  const v = read(VIEW_MODE_KEY);
  return v === "edit" || v === "view" || v === "both" ? v : "both";
}

export function writeViewMode(mode: NoteViewMode): void {
  write(VIEW_MODE_KEY, mode);
}

/**
 * Whether the blame gutter (who last edited each line) is shown. Defaults to
 * false, so the column is opt-in and someone who never turns it on sees the
 * note exactly as before.
 *
 * **Display only — it decides nothing about what is recorded.**
 * `YorkieNoteStore.editText` stamps the writer's display name onto *every*
 * insert (`app/notes/yorkie-note-store.ts`), whatever this key says, so
 * leaving the switch off hides the column and withholds no name. The gutter
 * and its per-edit authorship walk are what the flag installs
 * (`packages/notes/src/view/editor.ts`), not the attribution itself, and
 * `packages/documentation/notes/writing-a-note.md` warns the user in as many
 * words.
 *
 * Read by both `NotesView` mounts, the anonymous share-link one included, and
 * written by neither of them (see the module header).
 */
export function readShowAuthors(): boolean {
  return read(SHOW_AUTHORS_KEY) === "true";
}

export function writeShowAuthors(show: boolean): void {
  write(SHOW_AUTHORS_KEY, show ? "true" : "false");
}

export function readKeymap(): NoteKeymap {
  return read(KEYMAP_KEY) === "vim" ? "vim" : "default";
}

export function writeKeymap(mode: NoteKeymap): void {
  write(KEYMAP_KEY, mode);
}
