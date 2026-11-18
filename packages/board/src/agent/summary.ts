import { MAX_GROUP_DEPTH, type Element, type Frame } from '@wafflebase/slides';
import { isStickyData } from '../model/sticky';
import { isSectionElement, sectionMemberIds, sectionOf } from '../model/section';

/**
 * A compact, agent-readable view of a board: what an agent needs to run the
 * AI half of a brainstorm (read the stickies, cluster them, write a summary)
 * without walking the slides element model. Served by
 * `GET /api/v1/.../board/elements` and printed by `wafflebase board elements`.
 *
 * Read-only and derived: nothing here is stored. Section membership is the
 * board's own GEOMETRIC rule (`sectionMemberIds`), so the API reports exactly
 * what the canvas shows.
 */
export type BoardElementKind =
  | 'sticky'
  | 'section'
  | 'shape'
  | 'freeform'
  | 'text'
  | 'connector'
  | 'image'
  | 'group'
  | 'table'
  | 'chart';

export interface BoardElementSummary {
  id: string;
  kind: BoardElementKind;
  /** Plain text: paragraphs joined by `\n`. Absent when the element has none. */
  text?: string;
  /** Solid fill as `#RRGGBB`, when the element has one. */
  color?: string;
  frame: Frame;
  /** The innermost section this element lies in, by geometric membership. */
  section?: string;
  /** Section only: its title, and the flags that cover / freeze it. */
  title?: string;
  hidden?: true;
  locked?: true;
  /** Connector only: the elements its ends are glued to. */
  from?: string;
  to?: string;
  /** Stamp counts by kind (`{ plus1: 2, heart: 1 }`). */
  stamps?: Record<string, number>;
  /** Dot votes, reported only once the session has ended (the UI hides them before). */
  votes?: number;
  /** Sticky creator, unless the board is in anonymous mode. */
  author?: string;
}

/** The board-only root keys the summary reads, structurally typed. */
export interface BoardRitualsView {
  stamps?: Record<string, { el?: unknown; kind?: unknown } | undefined>;
  voting?: { status?: unknown; ballots?: Record<string, unknown> } | null;
  anonymous?: boolean;
}

type TextLike = { blocks?: { inlines?: { text?: unknown }[] }[] } | undefined;

function blocksText(body: TextLike): string | undefined {
  const blocks = body?.blocks;
  if (!Array.isArray(blocks)) return undefined;
  const text = blocks
    .map((b) =>
      Array.isArray(b?.inlines)
        ? b.inlines.map((i) => (typeof i?.text === 'string' ? i.text : '')).join('')
        : '',
    )
    .join('\n')
    .trim();
  return text.length > 0 ? text : undefined;
}

/** An element's text as plain characters, or `undefined` when it has none. */
export function plainText(el: Element, depth = 0): string | undefined {
  switch (el.type) {
    case 'text':
      return blocksText(el.data as TextLike);
    case 'shape':
      return blocksText((el.data as { text?: TextLike }).text);
    case 'connector':
      return blocksText((el as { label?: TextLike }).label);
    case 'group': {
      // The tree is stored content a peer wrote: stop at the shared group
      // depth cap rather than recursing as deep as it goes.
      if (depth >= MAX_GROUP_DEPTH) return undefined;
      const parts = el.data.children
        .map((c) => plainText(c, depth + 1))
        .filter((t): t is string => t !== undefined);
      return parts.length > 0 ? parts.join('\n') : undefined;
    }
    default:
      return undefined;
  }
}

/** The agent-facing kind of an element. */
export function elementKind(el: Element): BoardElementKind {
  if (el.type === 'shape') {
    if (isSectionElement(el)) return 'section';
    if (isStickyData(el.data)) return 'sticky';
    if (el.data.kind === 'freeform') return 'freeform';
    return 'shape';
  }
  return el.type;
}

/** A solid srgb fill as upper-case `#RRGGBB`, or `undefined`. */
export function solidColorOf(el: Element): string | undefined {
  if (el.type !== 'shape') return undefined;
  const fill = el.data.fill as { kind?: string; value?: unknown } | undefined;
  if (fill?.kind !== 'srgb' || typeof fill.value !== 'string') return undefined;
  return fill.value.toUpperCase();
}

function area(f: Frame): number {
  return Math.max(0, f.w) * Math.max(0, f.h);
}

/**
 * For every element inside at least one section, the innermost (smallest)
 * one. A nested section is reported inside its parent.
 */
export function innermostSections(elements: readonly Element[]): Map<string, string> {
  const sections = elements
    .filter((el) => isSectionElement(el))
    // Largest first, so a smaller section later overwrites its parent.
    .sort((a, b) => area(b.frame) - area(a.frame));
  const out = new Map<string, string>();
  for (const s of sections) {
    for (const id of sectionMemberIds(elements, s)) out.set(id, s.id);
  }
  return out;
}

function stampCounts(
  stamps: BoardRitualsView['stamps'],
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const s of Object.values(stamps ?? {})) {
    if (!s || typeof s.el !== 'string' || typeof s.kind !== 'string') continue;
    const counts = out.get(s.el) ?? {};
    counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    out.set(s.el, counts);
  }
  return out;
}

function voteCounts(voting: BoardRitualsView['voting']): Map<string, number> {
  const out = new Map<string, number>();
  // An open session's ballots are hidden in the UI until the facilitator
  // ends it, so the API does not reveal them either.
  if (!voting || voting.status !== 'ended') return out;
  for (const ballot of Object.values(voting.ballots ?? {})) {
    if (!Array.isArray(ballot)) continue;
    for (const id of ballot) {
      if (typeof id === 'string') out.set(id, (out.get(id) ?? 0) + 1);
    }
  }
  return out;
}

/** Summarize the board's top-level elements, in z-order (back to front). */
export function summarizeBoard(
  elements: readonly Element[],
  rituals: BoardRitualsView = {},
): BoardElementSummary[] {
  const inSection = innermostSections(elements);
  const stamps = stampCounts(rituals.stamps);
  const votes = voteCounts(rituals.voting);
  return elements.map((el) => {
    const kind = elementKind(el);
    const out: BoardElementSummary = {
      id: el.id,
      kind,
      frame: { ...el.frame },
    };
    const text = plainText(el);
    if (text !== undefined) out.text = text;
    const color = solidColorOf(el);
    if (color !== undefined) out.color = color;
    const section = inSection.get(el.id);
    if (section !== undefined) out.section = section;
    const meta = sectionOf(el);
    if (meta) {
      out.title = meta.title;
      if (meta.hidden) out.hidden = true;
      if (meta.locked) out.locked = true;
    }
    if (el.type === 'connector') {
      if (el.start.kind === 'attached') out.from = el.start.elementId;
      if (el.end.kind === 'attached') out.to = el.end.elementId;
    }
    const s = stamps.get(el.id);
    if (s) out.stamps = s;
    const v = votes.get(el.id);
    if (v) out.votes = v;
    if (kind === 'sticky' && el.type === 'shape' && !rituals.anonymous) {
      const author = (el.data as { author?: unknown }).author;
      if (typeof author === 'string' && author.length > 0) out.author = author;
    }
    return out;
  });
}
