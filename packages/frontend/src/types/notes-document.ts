import { Text } from '@yorkie-js/sdk';
import type { TextPosStructRange } from '@yorkie-js/sdk';

/**
 * Yorkie document root for a markdown note.
 *
 * The whole note is a single `yorkie.Text` CRDT at `content` — byte-compatible
 * with CodePair, so a future migration (P3) is a re-key, not a conversion.
 * Do NOT add fields to this root without treating it as a migration event.
 */
export type YorkieNotesRoot = {
  content: Text;
};

/**
 * Presence for a note editor. `username`/`email`/`photo` feed the shared
 * UserPresence avatar chrome; `color`/`name`/`selection`/`cursor` drive the
 * CodeMirror peer carets (ported from CodePair). The store updates only
 * `selection`/`cursor` via a partial `presence.set`, so the identity fields
 * set at attach time persist.
 */
export type NotesPresence = {
  username: string;
  email: string;
  photo: string;
  color: string;
  name: string;
  selection: TextPosStructRange | null;
  cursor: [number, number] | null;
};

/**
 * Initial Yorkie root for a new note. Creating the Text here means
 * `client.attach({ initialRoot })` seeds it inside the SDK and clears the
 * undo stack right after.
 */
export function initialNotesRoot(): Partial<YorkieNotesRoot> {
  return {
    content: new Text(),
  };
}

/**
 * Deterministic caret color for a note collaborator, derived from a stable
 * seed (the username). Same user → same distinguishable color across sessions
 * and across all peers' views. Returns an HSL string.
 */
export function noteUserColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}
