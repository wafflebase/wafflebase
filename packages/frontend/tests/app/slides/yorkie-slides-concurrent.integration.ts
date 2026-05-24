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

  it('A types into a placeholder while B applies a new layout → text and layout both survive', async () => {
    const ctx = await createTwoUserSlides('apply-layout-with-edit');
    try {
      let slideId = '';
      ctx.storeA.batch(() => { slideId = ctx.storeA.addSlide('title-body'); });
      await ctx.sync();

      // The 'title-body' layout lists title first, then body. read()
      // currently strips placeholderRef, so identify the title by
      // array order (slot index 0).
      const titleId = ctx.storeA.read().slides[0].elements[0].id;

      // A edits text on the title placeholder; B switches layout.
      // Mutate blocks in place via withTextElement: replace the inline
      // text with 'Hello' so the title element gets fully Yorkified
      // (proxy-backed) before B's applyLayout runs.
      ctx.storeA.batch(() => {
        ctx.storeA.withTextElement(slideId, titleId, (blocks) => {
          assert.ok(
            blocks[0]?.inlines[0],
            'title placeholder has no editable inline',
          );
          blocks[0].inlines[0].text = 'Hello';
        });
      });
      ctx.storeB.batch(() => ctx.storeB.applyLayout(slideId, 'title-only'));
      await ctx.sync();

      const a = ctx.storeA.read();
      const b = ctx.storeB.read();
      assert.equal(a.slides[0].layoutId, b.slides[0].layoutId);
      // The title element identity must survive the layout switch
      // — without the proxy-spread fix, applyLayoutToSlide would have
      // crashed with "Unsupported type of value: function" on B.
      assert.ok(
        a.slides[0].elements.some((e) => e.id === titleId),
        'A lost the title element',
      );
      assert.ok(
        b.slides[0].elements.some((e) => e.id === titleId),
        'B lost the title element',
      );

      // The title text typed by A must survive the concurrent
      // applyLayout from B on both peers.
      const aTitle = a.slides[0].elements.find((e) => e.id === titleId);
      const bTitle = b.slides[0].elements.find((e) => e.id === titleId);
      if (!aTitle || aTitle.type !== 'text') {
        assert.fail('A title element missing or not text');
      }
      if (!bTitle || bTitle.type !== 'text') {
        assert.fail('B title element missing or not text');
      }
      assert.equal(aTitle.data.blocks[0]?.inlines[0]?.text, 'Hello');
      assert.equal(bTitle.data.blocks[0]?.inlines[0]?.text, 'Hello');
    } finally {
      await ctx.cleanup();
    }
  });

  it('A moves a block of slides while B updates an element on one → both survive', async () => {
    const ctx = await createTwoUserSlides('move-block-vs-update');
    try {
      let id0 = '', id1 = '', id2 = '', elId = '';
      ctx.storeA.batch(() => {
        id0 = ctx.storeA.addSlide('blank');
        id1 = ctx.storeA.addSlide('blank');
        id2 = ctx.storeA.addSlide('blank');
        elId = ctx.storeA.addElement(id0, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
          data: { kind: 'rect', fill: '#0a0' },
        });
      });
      await ctx.sync();

      // Concurrent: A moves the block [id0, id2] to index 1; B updates the
      // element frame on id0 (which the rebuild-on-move path would discard).
      ctx.storeA.batch(() => ctx.storeA.moveSlides([id0, id2], 1));
      ctx.storeB.batch(() => ctx.storeB.updateElementFrame(id0, elId, { x: 500 }));
      await ctx.sync();

      const a = ctx.storeA.read();
      const b = ctx.storeB.read();
      assert.deepEqual(
        a.slides.map((s) => s.id),
        b.slides.map((s) => s.id),
      );
      // The block move landed: order is [id1, id0, id2].
      assert.deepEqual(a.slides.map((s) => s.id), [id1, id0, id2]);
      // B's concurrent element update survived on both peers.
      assert.equal(
        a.slides.find((s) => s.id === id0)!.elements[0].frame.x,
        500,
      );
      assert.equal(
        b.slides.find((s) => s.id === id0)!.elements[0].frame.x,
        500,
      );
    } finally {
      await ctx.cleanup();
    }
  });
});
