import type { NoteViewMode, NoteKeymap } from "@wafflebase/notes";

/**
 * Per-user (per-browser) notes editor preferences, persisted in localStorage.
 * These are USER settings, not document data — they must not live in the CRDT
 * or reset per note. The owner editor (NotesDetail) reads them on open and
 * writes them on change; the read-only shared viewer does not use them.
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
 * Whether the blame gutter (who last edited each line) is shown — and, with it,
 * whether this user's display name is recorded on the lines they edit. Defaults
 * to false: the feature is opt-in in both directions, so someone who never turns
 * it on sees the note exactly as before and leaves no name in its content.
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
