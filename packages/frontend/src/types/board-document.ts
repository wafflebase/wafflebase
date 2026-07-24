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

const PALETTE = ['#F94144', '#F3722C', '#F8961E', '#43AA8B', '#577590', '#277DA1'];
export function boardUserColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
