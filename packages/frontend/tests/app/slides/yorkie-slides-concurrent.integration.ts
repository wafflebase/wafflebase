/**
 * Concurrent multi-user integration tests for YorkieSlidesStore.
 *
 * Requires a running Yorkie server:
 *   docker compose up -d
 *   YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTwoUserSlides } from '../../helpers/two-user-slides-yorkie.ts';

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

describe('YorkieSlidesStore concurrent edits', { skip: !shouldRun }, () => {
  it('two clients add a slide each → both converge to two slides', async () => {
    const ctx = await createTwoUserSlides('add-add');
    try {
      ctx.storeA.batch(() => ctx.storeA.addSlide('blank'));
      ctx.storeB.batch(() => ctx.storeB.addSlide('title'));
      await ctx.sync();

      const a = ctx.storeA.read();
      const b = ctx.storeB.read();
      assert.equal(a.slides.length, 2);
      assert.equal(b.slides.length, 2);
      // Same ordering on both.
      assert.deepEqual(a.slides.map((s) => s.layoutId), b.slides.map((s) => s.layoutId));
    } finally {
      await ctx.cleanup();
    }
  });

  it('two clients add an element to the same slide → both converge to two elements', async () => {
    const ctx = await createTwoUserSlides('elem-add-add');
    try {
      let slideId = '';
      ctx.storeA.batch(() => { slideId = ctx.storeA.addSlide('blank'); });
      await ctx.sync();

      ctx.storeA.batch(() => ctx.storeA.addElement(slideId, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: '#a00' },
      }));
      ctx.storeB.batch(() => ctx.storeB.addElement(slideId, {
        type: 'shape',
        frame: { x: 50, y: 50, w: 80, h: 80, rotation: 0 },
        data: { kind: 'ellipse', fill: '#0a0' },
      }));
      await ctx.sync();

      const a = ctx.storeA.read();
      const b = ctx.storeB.read();
      assert.equal(a.slides[0].elements.length, 2);
      assert.equal(b.slides[0].elements.length, 2);
      // Same order on both.
      assert.deepEqual(
        a.slides[0].elements.map((e) => e.type),
        b.slides[0].elements.map((e) => e.type),
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('A moves a slide while B updates an element on it → both ops survive', async () => {
    const ctx = await createTwoUserSlides('move-vs-update');
    try {
      let id1 = '', id2 = '', elId = '';
      ctx.storeA.batch(() => {
        id1 = ctx.storeA.addSlide('blank');
        id2 = ctx.storeA.addSlide('blank');
        elId = ctx.storeA.addElement(id1, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
          data: { kind: 'rect', fill: '#a00' },
        });
      });
      await ctx.sync();

      // Concurrent: A moves slide id1 to position 1; B updates the
      // element's frame on slide id1 (which on B is still at position 0).
      ctx.storeA.batch(() => ctx.storeA.moveSlide(id1, 1));
      ctx.storeB.batch(() => ctx.storeB.updateElementFrame(id1, elId, { x: 500 }));
      await ctx.sync();

      const a = ctx.storeA.read();
      const b = ctx.storeB.read();
      assert.deepEqual(
        a.slides.map((s) => s.id),
        b.slides.map((s) => s.id),
      );
      // Slide id1 should now be at the moved position (1).
      assert.equal(a.slides[1].id, id1);
      // The element frame update should be visible on the moved slide.
      const updatedSlide = a.slides.find((s) => s.id === id1)!;
      assert.equal(updatedSlide.elements[0].frame.x, 500);
      assert.equal(b.slides.find((s) => s.id === id1)!.elements[0].frame.x, 500);
      void id2;
    } finally {
      await ctx.cleanup();
    }
  });

  it('A removes a slide while B adds an element to it → B\'s add is dropped (slide gone)', async () => {
    const ctx = await createTwoUserSlides('remove-vs-add');
    try {
      let id1 = '';
      ctx.storeA.batch(() => { id1 = ctx.storeA.addSlide('blank'); });
      await ctx.sync();

      ctx.storeA.batch(() => ctx.storeA.removeSlide(id1));
      // Note: B's mutation throws synchronously if the slide is already
      // gone in B's local view, but it isn't yet at this point — A's
      // remove hasn't been pulled. The element add should succeed locally,
      // then be effectively orphaned by the slide-remove on convergence.
      ctx.storeB.batch(() => ctx.storeB.addElement(id1, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: '#0a0' },
      }));
      await ctx.sync();

      const a = ctx.storeA.read();
      const b = ctx.storeB.read();
      // Both converge to zero slides — the slide is gone, so B's add
      // is effectively lost.
      assert.equal(a.slides.length, 0);
      assert.equal(b.slides.length, 0);
    } finally {
      await ctx.cleanup();
    }
  });

  it('two clients call applyLayout concurrently → both converge to one layoutId', async () => {
    const ctx = await createTwoUserSlides('apply-layout-converge');
    try {
      let slideId = '';
      ctx.storeA.batch(() => { slideId = ctx.storeA.addSlide('blank'); });
      await ctx.sync();

      ctx.storeA.batch(() => ctx.storeA.applyLayout(slideId, 'title-body'));
      ctx.storeB.batch(() => ctx.storeB.applyLayout(slideId, 'title-only'));
      await ctx.sync();

      const a = ctx.storeA.read();
      const b = ctx.storeB.read();
      // last-writer-wins on slide.layoutId; both peers must agree on whoever won.
      assert.equal(a.slides[0].layoutId, b.slides[0].layoutId);
      assert.ok(
        a.slides[0].layoutId === 'title-body' || a.slides[0].layoutId === 'title-only',
        `expected layoutId to be one of the two competitors; got ${a.slides[0].layoutId}`,
      );
    } finally {
      await ctx.cleanup();
    }
  });
});
