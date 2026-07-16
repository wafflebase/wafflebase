/**
 * Yorkie `Text` <-> note markdown serialization for the backend.
 *
 * A note's entire content is a single markdown string held in one Yorkie
 * `Text` CRDT at `root.content` (byte-compatible with CodePair — see
 * `packages/frontend/src/types/notes-document.ts` and
 * `packages/frontend/src/app/notes/yorkie-note-store.ts`). Unlike docs/slides
 * there is no block/tree structure to serialize, so the canonical content
 * shape the CLI/REST layer exchanges is just `{ content: string }`.
 *
 * The CLI consumes these through the shared content endpoint so it never
 * needs to ship a Yorkie SDK dependency.
 */
import { Text } from '@yorkie-js/sdk';

/**
 * Canonical note content JSON. The whole note *is* its markdown string.
 */
export interface NoteDocument {
  content: string;
}

/**
 * The Yorkie root shape used by note documents. Mirrors
 * `frontend/src/types/notes-document.ts#YorkieNotesRoot`.
 */
export interface NoteYorkieRoot extends Record<string, unknown> {
  content?: Text;
}

/**
 * Read the Yorkie root for a note and return the canonical `NoteDocument`.
 * Returns `{ content: '' }` if `content` is missing (an as-yet-unwritten
 * document — the frontend seeds the `Text` lazily on first attach).
 */
export function readNoteRoot(root: NoteYorkieRoot): NoteDocument {
  const text = root.content;
  // Guard on `.edit`, not `.toString` — every object has a `toString`, so a
  // mis-materialized content value (e.g. a plain `{context,text}` object from
  // the @yorkie-js/sdk vs @yorkie-js/react class-identity gap the frontend's
  // `ensureText` repairs) would otherwise serialize as "[object Object]". A
  // real Yorkie `Text` always carries `edit`; anything else reads as empty.
  if (!text || typeof text.edit !== 'function') {
    return { content: '' };
  }
  return { content: text.toString() };
}

/**
 * Replace the entire `content` Text on the Yorkie root with the note's
 * markdown. Caller must invoke this inside a `doc.update(root => …)` block.
 *
 * **Destructive contract:** this is a wipe-and-rewrite last-write-wins
 * primitive, mirroring `writeDocsRoot` / `writeSlidesRoot`. Concurrent
 * collaborator edits made between the read and the write may be lost; the
 * CLI import flow opts into this explicitly (`safety: destructive` upstream).
 *
 * If `content` is missing it is created via `new Text()`, mirroring the
 * frontend's `ensureText` seed in `notes-view.tsx`.
 */
export function writeNoteRoot(root: NoteYorkieRoot, doc: NoteDocument): void {
  let text = root.content;
  if (!text || typeof text.edit !== 'function') {
    root.content = new Text();
    text = root.content;
  }
  text.edit(0, text.length, doc.content);
}
