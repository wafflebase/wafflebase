import type { YorkieElement } from './slides-document';

export interface YorkieBoardRoot {
  meta: { title: string; unit?: 'in' | 'cm'; recentColors?: string[] };
  elements: YorkieElement[];
}

export function initialBoardRoot(): Partial<YorkieBoardRoot> {
  return { meta: { title: 'Untitled board' }, elements: [] };
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
