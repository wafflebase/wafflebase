import type { NoteViewMode, NoteKeymap } from "@wafflebase/notes";

/**
 * Per-user (per-browser) notes editor preferences, persisted in localStorage.
 * These are USER settings, not document data — they must not live in the CRDT
 * or reset per note. The owner editor (NotesDetail) reads them on open and
 * writes them on change; the read-only shared viewer does not use them.
 */
const VIEW_MODE_KEY = "wafflebase:notes:viewMode";
const KEYMAP_KEY = "wafflebase:notes:keymap";

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

export function readKeymap(): NoteKeymap {
  return read(KEYMAP_KEY) === "vim" ? "vim" : "default";
}

export function writeKeymap(mode: NoteKeymap): void {
  write(KEYMAP_KEY, mode);
}
