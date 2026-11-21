/**
 * `inset-inconsistent` — sibling cards whose text sits at different
 * distances from the card edge: one card's title pressed against its
 * border while the cards beside it have padding.
 *
 * A card is a box that paints (a fill or a border) and holds text: a
 * filled/bordered shape or text box with its own text, or a text-less
 * filled/bordered shape enclosing separate text elements (the inset is
 * then measured to the nearest enclosed text). Siblings are cards of
 * similar size (each side within 15%) that share a row or a column
 * (top or left edges within 4 px). Within a set of siblings, a card is
 * reported when its inset differs from the set's median by more than
 * `insetTolerance` (default 8 px); with an even count the larger middle
 * value is the reference, so of two cards the cramped one is reported.
 *
 * Measured on the painted text (`inkBox`):
 * - the top inset only when the text is top-anchored — middle- or
 *   bottom-anchored text moves with its amount, by design;
 * - the left inset only when every text paragraph is left-aligned
 *   (or justified) — centered text moves with its width.
 *
 * `info`: whether uneven padding is wrong is a judgment for a human.
 */
import type { Element } from '../../model/element';
import type { Slide } from '../../model/presentation';
import {
  encloses,
  fmt,
  hasText,
  inkBox,
  isBackground,
  layoutText,
  paintsBox,
  textTarget,
  type Box,
  type DeckContext,
  type PlacedElement,
} from '../context';
import type { Finding } from '../types';

const SIZE_TOLERANCE = 0.15;
const ALIGN_TOLERANCE = 4;

type Card = {
  id: string;
  box: Box;
  /** Text ink top minus card top, when meaningful (top-anchored). */
  top?: number;
  /** Text ink left minus card left, when meaningful (left-aligned). */
  left?: number;
};

function anchorOf(el: Element): 'top' | 'middle' | 'bottom' {
  return textTarget(el)?.body.verticalAnchor ?? (el.type === 'shape' ? 'middle' : 'top');
}

function leftAligned(el: Element): boolean {
  const blocks = textTarget(el)?.body.blocks ?? [];
  return blocks.every((b) => {
    const a = b.style?.alignment ?? 'left';
    return a === 'left' || a === 'justify';
  });
}

function collectCards(placed: PlacedElement[], ctx: DeckContext): Card[] {
  const texts = placed
    .filter((p) => hasText(p.el))
    .map((p) => ({ p, ink: inkBox(p, layoutText(p.el, ctx)) }));
  const cards: Card[] = [];
  for (const p of placed) {
    if (p.el.type !== 'shape' && p.el.type !== 'text') continue;
    if (!paintsBox(p.el) || p.world.rotation) continue;
    if (hasText(p.el)) {
      const ink = texts.find((t) => t.p === p)!.ink;
      cards.push({
        id: p.el.id,
        box: p.box,
        top: anchorOf(p.el) === 'top' ? ink.y - p.box.y : undefined,
        left: leftAligned(p.el) ? ink.x - p.box.x : undefined,
      });
      continue;
    }
    if (isBackground(p.el, p.box, ctx)) continue;
    const inside = texts.filter((t) => t.p !== p && !paintsBox(t.p.el) && encloses(p.box, t.ink));
    if (inside.length === 0) continue;
    const first = inside.reduce((a, b) => (b.ink.y < a.ink.y ? b : a));
    cards.push({
      id: p.el.id,
      box: p.box,
      top: anchorOf(first.p.el) === 'top' ? first.ink.y - p.box.y : undefined,
      left: inside.every((t) => leftAligned(t.p.el))
        ? Math.min(...inside.map((t) => t.ink.x)) - p.box.x
        : undefined,
    });
  }
  return cards;
}

function similar(a: number, b: number): boolean {
  return Math.abs(a - b) <= SIZE_TOLERANCE * Math.max(a, b);
}

function siblings(a: Card, b: Card): boolean {
  if (!similar(a.box.w, b.box.w) || !similar(a.box.h, b.box.h)) return false;
  return (
    Math.abs(a.box.y - b.box.y) <= ALIGN_TOLERANCE ||
    Math.abs(a.box.x - b.box.x) <= ALIGN_TOLERANCE
  );
}

/** Connected groups of sibling cards (union-find over the sibling relation). */
function clusters(cards: Card[]): Card[][] {
  const parent = cards.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (siblings(cards[i], cards[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Card[]>();
  cards.forEach((c, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), c]);
  });
  return [...groups.values()].filter((g) => g.length >= 2);
}

/** The median, taking the larger middle value for an even count. */
function upperMedian(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function checkInsetInconsistent(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  const tol = ctx.opts.insetTolerance;
  const notes = new Map<string, string[]>();
  for (const group of clusters(collectCards(placed, ctx))) {
    for (const side of ['top', 'left'] as const) {
      const measured = group.filter((c) => c[side] !== undefined);
      if (measured.length < 2) continue;
      const ref = upperMedian(measured.map((c) => c[side]!));
      for (const c of measured) {
        if (Math.abs(c[side]! - ref) <= tol) continue;
        const list = notes.get(c.id) ?? [];
        list.push(`${side} inset ${fmt(c[side]!)}px vs ${fmt(ref)}px in its sibling cards`);
        notes.set(c.id, list);
      }
    }
  }
  const findings: Finding[] = [];
  for (const p of placed) {
    const list = notes.get(p.el.id);
    if (!list) continue;
    findings.push({
      rule: 'inset-inconsistent',
      severity: 'info',
      slideId: slide.id,
      slideIndex,
      elementId: p.el.id,
      message: `text padding differs from sibling cards: ${list.join(', ')}`,
    });
  }
  return findings;
}
