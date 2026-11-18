import { boundingBox, type Element } from '@wafflebase/slides';
import { isMostlyInside, isSectionElement } from '../model/section';

/**
 * Section membership for a whole board at once, for the `/api/v1` board
 * endpoints, which answer one request per call on a single-threaded server.
 *
 * `sectionMemberIds` (the canvas's rule) walks every element for each
 * section, so a request that needs every section's members costs
 * O(sections × elements). This answers the same question from a uniform
 * grid over element centres, so a section only inspects the elements near
 * it — near-linear on a board whose sections do not all stack on top of
 * each other.
 *
 * Exact, not approximate: an element is a member when it is MOSTLY inside
 * ({@link isMostlyInside}, ratio ≥ 0.5), and an overlap of half the area
 * needs at least half the width and half the height. An interval of half
 * the width inside the element's span always contains its centre, so every
 * member's centre lies in the section's (closed) box. The grid lookup only
 * narrows the candidates to those; each one is then checked with the
 * canvas's own predicate. One cell of margin absorbs float rounding at a
 * cell edge.
 *
 * Bounded: the work a board can ask for is capped at
 * {@link MAX_MEMBERSHIP_CHECKS} candidate checks and grid cells visited,
 * past which {@link BoardTooLargeError} is thrown. Only a board whose
 * sections stack deep over thousands of elements gets there; the caller
 * turns it into a clear client error instead of holding the event loop.
 */

/** Most top-level elements the agent endpoints will process. */
export const MAX_AGENT_ELEMENTS = 50_000;

/** Most candidate checks (plus grid cells visited) one request may spend. */
export const MAX_MEMBERSHIP_CHECKS = 2_000_000;

/** The board is past what one agent request will process. */
export class BoardTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardTooLargeError';
  }
}

/** Refuse a board with more top-level elements than {@link MAX_AGENT_ELEMENTS}. */
export function assertAgentBoardSize(
  elements: readonly unknown[],
  max: number = MAX_AGENT_ELEMENTS,
): void {
  if (elements.length > max) {
    throw new BoardTooLargeError(
      `The board has ${elements.length} top-level elements; board API requests ` +
        `process at most ${max}.`,
    );
  }
}

export interface SectionMembership {
  /** Same result, in the same (z) order, as `sectionMemberIds(elements, section)`. */
  membersOf(section: Element): string[];
  /** Candidate checks and cells spent so far. */
  readonly spent: number;
}

function area(f: { w: number; h: number }): number {
  return Math.max(0, f.w) * Math.max(0, f.h);
}

export function createSectionMembership(
  elements: readonly Element[],
  budget: number = MAX_MEMBERSHIP_CHECKS,
): SectionMembership {
  const n = elements.length;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const b = boundingBox(elements[i].frame);
    const x = b.x + b.w / 2;
    const y = b.y + b.h / 2;
    // A NaN frame can be no section's member (isMostlyInside is false on
    // NaN); park it outside the grid.
    cx[i] = Number.isFinite(x) ? x : NaN;
    cy[i] = Number.isFinite(y) ? y : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  // About one element per cell, on a near-square grid of about n cells.
  const spanX = Math.max(maxX - minX, 0);
  const spanY = Math.max(maxY - minY, 0);
  const side = Math.max(Math.sqrt((Math.max(spanX, 1) * Math.max(spanY, 1)) / Math.max(n, 1)), 1);
  const gx = n === 0 ? 1 : Math.min(Math.floor(spanX / side) + 1, n + 1);
  const gy = n === 0 ? 1 : Math.min(Math.floor(spanY / side) + 1, n + 1);
  const sx = spanX / gx || 1;
  const sy = spanY / gy || 1;
  const col = (x: number) => Math.min(gx - 1, Math.max(0, Math.floor((x - minX) / sx)));
  const row = (y: number) => Math.min(gy - 1, Math.max(0, Math.floor((y - minY) / sy)));

  // Counting sort of element indices into cells, ascending within a cell.
  const start = new Int32Array(gx * gy + 1);
  const cellOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(cx[i]) || Number.isNaN(cy[i])) continue;
    const c = row(cy[i]) * gx + col(cx[i]);
    cellOf[i] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < gx * gy; c++) start[c + 1] += start[c];
  const fill = start.slice(0, gx * gy);
  const items = new Int32Array(start[gx * gy]);
  for (let i = 0; i < n; i++) {
    if (cellOf[i] >= 0) items[fill[cellOf[i]]++] = i;
  }

  let spent = 0;
  const spend = (k: number) => {
    spent += k;
    if (spent > budget) {
      throw new BoardTooLargeError(
        'The board has too many elements inside overlapping sections for one ' +
          'board API request. Split it into smaller sections or fewer elements.',
      );
    }
  };

  return {
    get spent() {
      return spent;
    },
    membersOf(section) {
      const s = boundingBox(section.frame);
      if (n === 0 || !(s.w >= 0 && s.h >= 0)) return [];
      const ownArea = area(section.frame);
      const c0 = Math.max(0, col(s.x) - 1);
      const c1 = Math.min(gx - 1, col(s.x + s.w) + 1);
      const r0 = Math.max(0, row(s.y) - 1);
      const r1 = Math.min(gy - 1, row(s.y + s.h) + 1);
      const hits: number[] = [];
      for (let r = r0; r <= r1; r++) {
        spend(c1 - c0 + 1);
        for (let c = c0; c <= c1; c++) {
          const cell = r * gx + c;
          const end = start[cell + 1];
          spend(end - start[cell]);
          for (let k = start[cell]; k < end; k++) {
            const i = items[k];
            const el = elements[i];
            if (el.id === section.id) continue;
            if (isSectionElement(el) && area(el.frame) >= ownArea) continue;
            if (isMostlyInside(el.frame, section.frame)) hits.push(i);
          }
        }
      }
      hits.sort((a, b) => a - b);
      return hits.map((i) => elements[i].id);
    },
  };
}
