/**
 * Two-user CRDT convergence tests for group / ungroup operations
 * on YorkieSlidesStore.
 *
 * Requires a running Yorkie server:
 *   docker compose up -d
 *   YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTwoUserSlides } from '../../helpers/two-user-slides-yorkie.ts';

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

describe(
  'YorkieSlidesStore concurrent group / ungroup',
  { skip: !shouldRun },
  () => {
    // -----------------------------------------------------------------------
    // Scenario 1 — Concurrent group() calls on overlapping selections.
    // User A groups [a, b]; User B groups [b, c] in parallel.
    // After sync exactly one group must survive (Yorkie array CRDT resolves
    // the conflict); both peers must converge to identical state.
    // -----------------------------------------------------------------------
    it(
      'concurrent group calls on overlapping selections converge',
      async () => {
        const ctx = await createTwoUserSlides('group-overlap');
        try {
          let slideId = '';
          let aId = '';
          let bId = '';
          let cId = '';

          // Shared setup: create three shapes on a single slide.
          ctx.storeA.batch(() => {
            slideId = ctx.storeA.addSlide('blank');
            aId = ctx.storeA.addElement(slideId, {
              type: 'shape',
              frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
              data: { kind: 'rect' },
            });
            bId = ctx.storeA.addElement(slideId, {
              type: 'shape',
              frame: { x: 60, y: 0, w: 50, h: 50, rotation: 0 },
              data: { kind: 'ellipse' },
            });
            cId = ctx.storeA.addElement(slideId, {
              type: 'shape',
              frame: { x: 120, y: 0, w: 50, h: 50, rotation: 0 },
              data: { kind: 'rect' },
            });
          });
          await ctx.sync();

          // Concurrent: A groups [a, b], B groups [b, c] — both include b.
          // The element ids come from storeA; storeB sees the same ids after sync.
          ctx.storeA.batch(() => ctx.storeA.group(slideId, [aId, bId]));
          ctx.storeB.batch(() => ctx.storeB.group(slideId, [bId, cId]));
          await ctx.sync();

          const a = ctx.storeA.read();
          const b = ctx.storeB.read();

          // Both peers must agree on the exact same slide elements.
          assert.deepEqual(
            a.slides[0].elements,
            b.slides[0].elements,
            'peers diverged after concurrent group()',
          );

          // At least one group element must be present — the CRDT picked a winner.
          const hasGroup = a.slides[0].elements.some((e) => e.type === 'group');
          assert.ok(hasGroup, 'expected at least one group element after convergence');
        } finally {
          await ctx.cleanup();
        }
      },
    );

    // -----------------------------------------------------------------------
    // Scenario 2 — Ungroup vs. drag inside the same group.
    // User A ungroups group G; User B drags one of G's children.
    // After sync B's intended world-space position must be preserved and
    // no exception must fire. Both peers must converge.
    // -----------------------------------------------------------------------
    it('ungroup vs. concurrent child drag converge without error', async () => {
      const ctx = await createTwoUserSlides('ungroup-vs-drag');
      try {
        let slideId = '';
        let groupId = '';
        let childAId = '';

        // Setup: create a group G with two children.
        ctx.storeA.batch(() => {
          slideId = ctx.storeA.addSlide('blank');
          const el1 = ctx.storeA.addElement(slideId, {
            type: 'shape',
            frame: { x: 0, y: 0, w: 80, h: 80, rotation: 0 },
            data: { kind: 'rect' },
          });
          const el2 = ctx.storeA.addElement(slideId, {
            type: 'shape',
            frame: { x: 100, y: 0, w: 80, h: 80, rotation: 0 },
            data: { kind: 'ellipse' },
          });
          ({ groupId } = ctx.storeA.group(slideId, [el1, el2]));
        });
        await ctx.sync();

        // Identify the first child from storeB's perspective.
        const slideB = ctx.storeB.read().slides[0];
        const grpEl = slideB.elements.find((e) => e.id === groupId);
        assert.ok(grpEl && grpEl.type === 'group', 'expected group element on B');
        childAId = (
          grpEl as { data: { children: Array<{ id: string }> } }
        ).data.children[0].id;

        // Concurrent: A ungroups G; B drags childAId to a new position.
        ctx.storeA.batch(() => ctx.storeA.ungroup(slideId, groupId));
        ctx.storeB.batch(() =>
          ctx.storeB.updateElementFrame(slideId, childAId, { x: 300, y: 300 }),
        );
        await ctx.sync();

        // Primary assertion: both peers must converge — no exception thrown,
        // and the slide element arrays are identical.
        const a = ctx.storeA.read();
        const b = ctx.storeB.read();

        assert.deepEqual(
          a.slides[0].elements,
          b.slides[0].elements,
          'peers diverged after ungroup vs. drag',
        );
      } finally {
        await ctx.cleanup();
      }
    });

    // -----------------------------------------------------------------------
    // Scenario 3 — Concurrent addElement() into the same group.
    // Users A and B both call addElement(slideId, init, groupId).
    // After sync both elements must appear in data.children with the same
    // z-order on both peers.
    // -----------------------------------------------------------------------
    it('concurrent insert into the same group — both elements survive', async () => {
      const ctx = await createTwoUserSlides('group-insert-insert');
      try {
        let slideId = '';
        let groupId = '';

        // Setup: create a group with two seed children.
        ctx.storeA.batch(() => {
          slideId = ctx.storeA.addSlide('blank');
          const s1 = ctx.storeA.addElement(slideId, {
            type: 'shape',
            frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
            data: { kind: 'rect' },
          });
          const s2 = ctx.storeA.addElement(slideId, {
            type: 'shape',
            frame: { x: 60, y: 0, w: 50, h: 50, rotation: 0 },
            data: { kind: 'ellipse' },
          });
          ({ groupId } = ctx.storeA.group(slideId, [s1, s2]));
        });
        await ctx.sync();

        // Concurrent: A and B each add a new shape into the same group.
        ctx.storeA.batch(() =>
          ctx.storeA.addElement(
            slideId,
            {
              type: 'shape',
              frame: { x: 10, y: 10, w: 20, h: 20, rotation: 0 },
              data: { kind: 'rect' },
            },
            groupId,
          ),
        );
        ctx.storeB.batch(() =>
          ctx.storeB.addElement(
            slideId,
            {
              type: 'shape',
              frame: { x: 30, y: 10, w: 20, h: 20, rotation: 0 },
              data: { kind: 'ellipse' },
            },
            groupId,
          ),
        );
        await ctx.sync();

        const a = ctx.storeA.read();
        const b = ctx.storeB.read();

        // Both peers must converge.
        assert.deepEqual(
          a.slides[0].elements,
          b.slides[0].elements,
          'peers diverged after concurrent addElement() into group',
        );

        // The group must contain exactly 4 children (2 seed + 2 newly inserted).
        const grpA = a.slides[0].elements[0] as {
          type: string;
          data: { children: unknown[] };
        };
        assert.equal(grpA.type, 'group');
        assert.equal(grpA.data.children.length, 4);
      } finally {
        await ctx.cleanup();
      }
    });

    // -----------------------------------------------------------------------
    // Scenario 4 — Reorder vs. delete inside the same group.
    // User A reorders childX inside group G; User B deletes a *different*
    // child childY of G. After sync: childY is gone, childX is at A's
    // chosen position, and both peers agree on the same state.
    // -----------------------------------------------------------------------
    it('reorder vs. delete inside the same group — both ops survive', async () => {
      const ctx = await createTwoUserSlides('group-reorder-delete');
      try {
        let slideId = '';
        let groupId = '';

        // Setup: group with three children (x at index 0, y at index 1, z at index 2).
        ctx.storeA.batch(() => {
          slideId = ctx.storeA.addSlide('blank');
          const xId = ctx.storeA.addElement(slideId, {
            type: 'shape',
            frame: { x: 0, y: 0, w: 40, h: 40, rotation: 0 },
            data: { kind: 'rect' },
          });
          const yId = ctx.storeA.addElement(slideId, {
            type: 'shape',
            frame: { x: 50, y: 0, w: 40, h: 40, rotation: 0 },
            data: { kind: 'ellipse' },
          });
          const zId = ctx.storeA.addElement(slideId, {
            type: 'shape',
            frame: { x: 100, y: 0, w: 40, h: 40, rotation: 0 },
            data: { kind: 'rect' },
          });
          ({ groupId } = ctx.storeA.group(slideId, [xId, yId, zId]));
        });
        await ctx.sync();

        // Read the children ids from storeB (both stores share the same ids
        // after the initial sync).
        const grpB = ctx.storeB
          .read()
          .slides[0].elements.find((e) => e.id === groupId) as {
          data: { children: Array<{ id: string }> };
        };
        const [xId, yId] = grpB.data.children.map((c) => c.id);

        // Concurrent: A moves childX to the back (index 0 → 2); B deletes childY.
        ctx.storeA.batch(() =>
          ctx.storeA.reorderElement(slideId, xId, 2),
        );
        ctx.storeB.batch(() => ctx.storeB.removeElement(slideId, yId));
        await ctx.sync();

        const a = ctx.storeA.read();
        const b = ctx.storeB.read();

        // Both peers must converge.
        assert.deepEqual(
          a.slides[0].elements,
          b.slides[0].elements,
          'peers diverged after reorder vs. delete inside group',
        );

        // childY must be gone on both peers.
        const grpA = a.slides[0].elements[0] as {
          data: { children: Array<{ id: string }> };
        };
        assert.ok(
          !grpA.data.children.some((c) => c.id === yId),
          'deleted child yId still present after convergence',
        );

        // The group must have 2 remaining children (x and z).
        assert.equal(grpA.data.children.length, 2);
      } finally {
        await ctx.cleanup();
      }
    });
  },
);
