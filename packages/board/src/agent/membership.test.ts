import { describe, expect, it } from 'vitest';
import { boundingBox, type Element, type Frame } from '@wafflebase/slides';
import { buildSectionInit, sectionMemberIds } from '../model/section';
import {
  BoardTooLargeError,
  MAX_MEMBERSHIP_CHECKS,
  assertAgentBoardSize,
  createSectionMembership,
} from './membership';
import { findFreeRect } from './layout';
import { planMoves } from './moves';
import { summarizeBoard } from './summary';

/** Deterministic PRNG, so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const section = (id: string, f: Omit<Frame, 'rotation'>, locked = false): Element => {
  const el = { ...buildSectionInit(f, { title: id }), id } as Element;
  if (locked) (el as unknown as { data: { section: { locked?: boolean } } }).data.section.locked = true;
  return el;
};

const shape = (id: string, x: number, y: number, w = 200, h = 200, rotation = 0): Element =>
  ({ id, type: 'shape', frame: { x, y, w, h, rotation }, data: { kind: 'rect' } }) as unknown as Element;

function randomBoard(seed: number, n: number, sections: number): Element[] {
  const r = rng(seed);
  const out: Element[] = [];
  for (let s = 0; s < sections; s++) {
    out.push(section(`s${s}`, { x: r() * 4000 - 2000, y: r() * 4000 - 2000, w: r() * 2500, h: r() * 2500 }));
  }
  for (let i = 0; i < n; i++) {
    // Include rotated and zero-size elements: both take the special paths.
    const w = r() < 0.1 ? 0 : r() * 400;
    out.push(shape(`e${i}`, r() * 5000 - 2500, r() * 5000 - 2500, w, r() * 400, r() < 0.2 ? r() * 360 : 0));
  }
  return out;
}

/** The pre-index search: every candidate against every box. */
function bruteFreeRect(occupied: Frame[], size: { w: number; h: number }, aim: { x: number; y: number }, gap = 24) {
  const boxes = occupied.map((f) => boundingBox(f));
  const stepX = size.w + gap;
  const stepY = size.h + gap;
  const rank = (k: number) => (k === 0 ? 0 : k > 0 ? 2 * k - 1 : -2 * k);
  for (let ring = 0; ring <= 24; ring++) {
    const cells: { i: number; j: number }[] = [];
    for (let j = -ring; j <= ring; j++)
      for (let i = -ring; i <= ring; i++) if (Math.max(Math.abs(i), Math.abs(j)) === ring) cells.push({ i, j });
    cells.sort((a, b) => rank(a.j) - rank(b.j) || rank(a.i) - rank(b.i));
    for (const { i, j } of cells) {
      const p = { x: aim.x + i * stepX, y: aim.y + j * stepY };
      const hit = boxes.some(
        (b) =>
          p.x < b.x + b.w + gap && b.x < p.x + size.w + gap && p.y < b.y + b.h + gap && b.y < p.y + size.h + gap,
      );
      if (!hit) return p;
    }
  }
  return { x: boxes.reduce((m, b) => Math.max(m, b.x + b.w), aim.x) + 96, y: aim.y };
}

describe('createSectionMembership', () => {
  it('answers exactly what sectionMemberIds answers, in the same order', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const els = randomBoard(seed, 300, 15);
      const index = createSectionMembership(els);
      for (const s of els.filter((e) => e.id.startsWith('s'))) {
        expect(index.membersOf(s)).toEqual(sectionMemberIds(els, s));
      }
    }
  });

  it('counts an element whose centre sits exactly on the section edge', () => {
    const s = section('s', { x: 0, y: 0, w: 100, h: 100 });
    const edge = shape('edge', 50, 0, 100, 100); // half inside: ratio 0.5
    const els = [s, edge];
    expect(sectionMemberIds(els, s)).toEqual(['edge']);
    expect(createSectionMembership(els).membersOf(s)).toEqual(['edge']);
  });

  it('refuses a board past the element cap', () => {
    expect(() => assertAgentBoardSize(new Array(11), 10)).toThrow(BoardTooLargeError);
    expect(() => assertAgentBoardSize(new Array(10), 10)).not.toThrow();
  });
});

describe('findFreeRect', () => {
  it('returns the same spot as testing every candidate against every box', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const occupied = randomBoard(seed, 200, 5).map((e) => e.frame);
      const size = { w: 50 + r() * 400, h: 50 + r() * 400 };
      const aim = { x: r() * 2000 - 1000, y: r() * 2000 - 1000 };
      expect(findFreeRect(occupied, size, aim)).toEqual(bruteFreeRect(occupied, size, aim));
    }
  });
});

describe('a large board (20k elements, 500 sections)', () => {
  // 500 disjoint 1800px sections on a 25×20 grid, with 20,000 stickies laid
  // over the whole plane; every other section is locked.
  function bigBoard(): Element[] {
    const els: Element[] = [];
    for (let s = 0; s < 500; s++) {
      els.push(section(`s${s}`, { x: (s % 25) * 2000, y: Math.floor(s / 25) * 2000, w: 1800, h: 1800 }, s % 2 === 0));
    }
    for (let i = 0; i < 20_000; i++) {
      els.push(shape(`e${i}`, (i % 200) * 250, Math.floor(i / 200) * 250));
    }
    return els;
  }

  it('computes membership near-linearly, far under the naive sections × elements', () => {
    const els = bigBoard();
    const index = createSectionMembership(els);
    let members = 0;
    for (const el of els.slice(0, 500)) members += index.membersOf(el).length;
    expect(members).toBeGreaterThan(0);
    // The naive walk is 500 × 20,500 ≈ 10M checks; the index spends a few
    // candidates per member.
    expect(index.spent).toBeLessThan(200_000);
  });

  it('summarizes, moves and places on it without tripping the budget', () => {
    const els = bigBoard();
    const out = summarizeBoard(els);
    expect(out.find((e) => e.id === 'e0')?.section).toBe('s0');
    const moved = planMoves(els, [{ id: 's1', x: 2000, y: 100_000 }]);
    expect(moved.ok && moved.carried.length).toBeGreaterThan(0);
    const p = findFreeRect(els.map((e) => e.frame), { w: 180, h: 180 }, { x: 100, y: 100 });
    expect(Number.isFinite(p.x)).toBe(true);
  });

  it('places past 20k boxes that each block every candidate in one pass', () => {
    // Brute force is 2,401 candidates × 20,000 boxes here; the lattice
    // marks each box once.
    const occupied: Frame[] = Array.from({ length: 20_000 }, (_, i) => ({
      x: -1_000_000 + i,
      y: -1_000_000,
      w: 2_000_000,
      h: 2_000_000,
      rotation: 0,
    }));
    const t = performance.now();
    const p = findFreeRect(occupied, { w: 180, h: 180 }, { x: 0, y: 0 });
    // Generous: a CI box under load, against seconds for the product walk.
    expect(performance.now() - t).toBeLessThan(500);
    expect(p).toEqual({ x: -1_000_000 + 19_999 + 2_000_000 + 96, y: 0 });
  });

  it('refuses a board of stacked sections instead of walking it', () => {
    // 500 nested sections over the same 20k elements: every section holds
    // every element, the case no index can make cheap.
    const els: Element[] = [];
    for (let s = 0; s < 500; s++) {
      els.push(section(`s${s}`, { x: -s, y: -s, w: 60_000 + 2 * s, h: 60_000 + 2 * s }));
    }
    for (let i = 0; i < 20_000; i++) els.push(shape(`e${i}`, (i % 200) * 250, Math.floor(i / 200) * 250));
    expect(() => summarizeBoard(els)).toThrow(BoardTooLargeError);
    const index = createSectionMembership(els);
    try {
      for (const el of els.slice(0, 500)) index.membersOf(el);
    } catch {
      /* expected */
    }
    // It stopped at the budget, not after the full walk.
    expect(index.spent).toBeLessThanOrEqual(MAX_MEMBERSHIP_CHECKS + 60_000);
  });
});
