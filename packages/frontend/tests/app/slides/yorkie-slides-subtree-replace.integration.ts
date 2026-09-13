/**
 * Regression: a wholesale replace of a nested Yorkie object (`frame`,
 * `data`) makes the operation's reverse a `RemoveOperation` rather than a
 * restoring `SetOperation` whenever the node it displaces is already a
 * tombstone — see `SetOperation.toReverseOperation` in `@yorkie-js/sdk`. A
 * later undo then deletes the key outright, and the loss is committed to the
 * server, so every later reader of the deck dies on it:
 *
 *   `data` gone  → `ensureSlidesRoot`  → reading 'blocks'
 *   `frame` gone → `element-renderer`  → reading 'flipH'
 *
 * This replays an op stream that reproduced exactly that against a real
 * server (found by a randomised soak; see
 * `docs/tasks/active/20260910-slides-frameless-element-todo.md`). It is a
 * sequence observed to do it, not a synthetic construction: it hinges on the
 * autofit-grow commit path, which writes the text body and fits the frame
 * height in ONE batch, interleaved with a peer's edits and an undo/redo.
 *
 * Requires a running Yorkie server:
 *   docker compose up -d
 *   YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTwoUserSlides } from '../../helpers/two-user-slides-yorkie.ts';
import type { TwoUserSlidesContext } from '../../helpers/two-user-slides-yorkie.ts';
import type { YorkieSlidesStore } from '@/app/slides/yorkie-slides-store.ts';

type Doc = { toJSON(): string };
const docOf = (s: YorkieSlidesStore) => (s as unknown as { doc: Doc }).doc;

/**
 * Elements whose `frame` or `data` node is gone, read from the raw CRDT
 * rather than through `store.read()` — the read path carries a fallback that
 * would mask exactly what this test is looking for.
 */
function strippedElements(store: YorkieSlidesStore, who: string): string[] {
  const root = JSON.parse(docOf(store).toJSON()) as {
    slides?: { id: string; elements?: Record<string, unknown>[] }[];
  };
  const out: string[] = [];
  for (const slide of root.slides ?? []) {
    for (const el of slide.elements ?? []) {
      if (el.type === 'connector') continue;
      const missing: string[] = [];
      if (el.frame === undefined) missing.push('frame');
      if (el.data === undefined) missing.push('data');
      if (missing.length) {
        out.push(`${who} ${String(el.id)} lost ${missing.join('+')}`);
      }
    }
  }
  return out;
}

function assertIntact(ctx: TwoUserSlidesContext, label: string): void {
  const bad = [
    ...strippedElements(ctx.storeA, 'A'),
    ...strippedElements(ctx.storeB, 'B'),
  ];
  assert.deepEqual(bad, [], `${label}: ${bad.join('; ')}`);
}

/** Text write + frame fit in ONE batch — the editor's autofit-grow commit. */
function commitGrow(
  store: YorkieSlidesStore,
  slideId: string,
  elementId: string,
  text: string,
  h: number,
): void {
  store.batch(() => {
    store.withTextElement(slideId, elementId, () => [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [{ text, style: {} }],
        style: {},
      },
    ]);
    store.updateElementFrame(slideId, elementId, { h });
  });
}

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

describe('nested subtree writes survive concurrent undo/redo', { skip: !shouldRun }, () => {
  it('an autofit commit undone twice and redone keeps `data`', async () => {
    // Replays the seed-1051 shape: A commits a grow, undoes past it, a peer
    // edits the same element, then A redoes. Before the per-field fix this
    // left B's copy — and the server's — holding an element stripped of
    // `data`, and sometimes of `frame` too; which of the two goes depends on
    // op timing, so the assertion covers both rather than naming one.
    const ctx = await createTwoUserSlides('subtree-redo-data');
    try {
      let slideId = '';
      ctx.storeA.batch(() => { slideId = ctx.storeA.addSlide('caption'); });
      await ctx.sync();
      const [first, second] = ctx.storeA.read().slides[0].elements;

      commitGrow(ctx.storeA, slideId, first.id, 'ㅇㅇㅇ', 300);
      ctx.storeA.undo();
      ctx.storeA.undo();
      ctx.storeB.batch(() => ctx.storeB.removeElement(slideId, second.id));
      commitGrow(ctx.storeB, slideId, first.id, 'ㅇㅇㅇㅇㅇㅇ', 420);
      await ctx.sync();
      ctx.storeA.redo();
      await ctx.sync();

      assertIntact(ctx, 'after redo');
    } finally {
      await ctx.cleanup();
    }
  });
});
