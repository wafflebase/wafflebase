import type { YorkieElement } from './slides-document';

export interface YorkieBoardRoot {
  meta: { title: string; unit?: 'in' | 'cm'; recentColors?: string[] };
  elements: YorkieElement[];
}

export function initialBoardRoot(): Partial<YorkieBoardRoot> {
  return { meta: { title: 'Untitled board' }, elements: [] };
}

export type BoardPresence = {
  username: string;
  email: string;
  photo: string;
  selectedElementIds?: string[];
  cursor?: { x: number; y: number } | null; // world coords
};
