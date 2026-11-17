import type { YorkieElement } from './slides-document';
import type { BoardAnchor, Thread } from './comments';
import type { BoardStamps, BoardVoting } from '@/app/board/rituals/types';

export interface YorkieBoardRoot {
  meta: {
    title: string;
    unit?: 'in' | 'cm';
    recentColors?: string[];
    /**
     * Anonymous mode: hide every sticky author name on the board and
     * record none on new stickies. Absent ⇒ off.
     */
    anonymous?: boolean;
  };
  elements: YorkieElement[];
  /** Stamps on elements (additive; see `app/board/rituals/types.ts`). */
  stamps?: BoardStamps;
  /** The dot-voting session, when one is running or its results are shown. */
  voting?: BoardVoting;
  /** Comment threads, keyed by thread id (same shape as pdf/docs). */
  comments?: { [threadId: string]: Thread<BoardAnchor> };
}

/**
 * `stamps` and `comments` are seeded empty so two users' first writes
 * merge into one shared container instead of racing to create it (Yorkie
 * resolves a same-key object assignment by LWW). The SDK seeds absent
 * keys on every editor attach, so existing boards gain them too.
 */
export function initialBoardRoot(): Partial<YorkieBoardRoot> {
  return {
    meta: { title: 'Untitled board' },
    elements: [],
    stamps: {},
    comments: {},
  };
}

/**
 * The root a share-link visitor should attach with, given their role.
 *
 * The Yorkie SDK writes every `initialRoot` key the document does not already
 * have, on each attach — so a viewer opening a never-edited document creates
 * these keys from their own client, before any read-only machinery exists.
 * Only the viewer role is exempt; every other role still seeds, so the
 * concurrency argument for seeding at bootstrap is untouched.
 *
 * Safe for board because nothing writes on mount and both reads guard:
 * `YorkieBoardStore.read()`/`readMeta()` fall back to `{}` and `[]`, and the
 * title defaults to the same 'Untitled board' this seeds. A viewer sees an
 * empty canvas, which is what a never-edited board is.
 */
export function boardInitialRootForRole(
  role: string,
): Partial<YorkieBoardRoot> {
  return role === 'viewer' ? {} : initialBoardRoot();
}

export type BoardPresence = {
  username: string;
  email: string;
  photo: string;
  selectedElementIds?: string[];
  cursor?: { x: number; y: number } | null; // world coords
};
