# Slides Phase 4b (Equivalence + Two-User + Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Close the verification gap left by Phase 4a. Land
single-client equivalence tests that prove `YorkieSlidesStore`
produces the same outcomes as `MemSlidesStore`, plus a real-server
two-user concurrency suite that verifies multi-user convergence on
add / move / delete / update operations. End the phase with a green
`pnpm frontend test:integration` lane when a Yorkie server is
available.

**Architecture:**
- Equivalence tests use `node:test` (the frontend test convention),
  filename `*.test.ts` so they run in `verify:fast`. They construct
  a local `yorkie.Document` (no Client, no server) so the test stays
  in-process and fast.
- Two-user tests use `node:test` too but live as `*.integration.ts`
  files invoked via `pnpm frontend test:integration`. They need the
  `YORKIE_RPC_ADDR` env var pointed at a running Yorkie server
  (`docker compose up -d` from the repo root). The suite is
  `{ skip: !shouldRun }` so the regular test lane skips it cleanly
  when env is absent.
- The `two-user-slides-yorkie.ts` helper mirrors
  `two-user-docs-yorkie.ts` byte-for-byte in shape (createTwoUserSlides
  + sync + cleanup), differing only in the store class and the
  initial root.

**Spec:** [`docs/design/slides/slides.md`](../../design/slides/slides.md)
section "Yorkie schema" plus the spec-level guarantees about
convergence (Yorkie.Array.move, deterministic z-order). This plan
delivers todo items 4.2 (equivalence), 4.8 (two-user helper +
concurrency suite), 4.9 (verify:integration green).

---

## File structure

Created in this phase:

```
packages/frontend/tests/
├── helpers/
│   └── two-user-slides-yorkie.ts                # T2
└── app/slides/
    ├── yorkie-slides-equivalence.test.ts        # T1
    └── yorkie-slides-concurrent.integration.ts  # T2
```

Modified in this phase:

- `docs/tasks/active/20260505-slides-package-mvp-todo.md` — tick 4.2, 4.8, 4.9

No source changes — Phase 4b is verification work.

---

## Conventions

Same as Phase 4a. Frontend tests use `node:test`. Equivalence test
file ends in `.test.ts`; concurrency test file ends in
`.integration.ts`. No `--no-verify`. Branch: `feat/slides-phase1`.

The `RUN_*_TESTS` env-var gating: integration tests skip when
`YORKIE_RPC_ADDR` is not set, exactly like `yorkie-doc-store-concurrent.integration.ts`.

---

## Task 1: Equivalence tests

**Files:**
- Create: `packages/frontend/tests/app/slides/yorkie-slides-equivalence.test.ts`

For each interesting op sequence, run it against BOTH stores
(`MemSlidesStore` and `YorkieSlidesStore` over a local Yorkie
Document) and assert their `read()` snapshots match.

A few op sequences to cover:
- Add three slides → reorder → remove one
- Add an element → updateElementFrame → reorderElement → remove
- Apply layout to a slide that already has user-edited elements
- batch / undo / redo round-trip

The two stores both implement `SlidesStore` so a parameterised helper
keeps the tests dry.

- [ ] **Step 1.1: Write the test file**

Create `packages/frontend/tests/app/slides/yorkie-slides-equivalence.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import yorkie from '@yorkie-js/sdk';
import {
  MemSlidesStore,
  type SlidesDocument,
  type SlidesStore,
} from '@wafflebase/slides';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '@/app/slides/yorkie-slides-store.ts';
import type { YorkieSlidesRoot } from '@/types/slides-document.ts';

function makeYorkie(): YorkieSlidesStore {
  const doc = new (yorkie as unknown as {
    Document: new (key: string) => yorkie.Document<YorkieSlidesRoot>;
  }).Document(`equiv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  ensureSlidesRoot(doc);
  return new YorkieSlidesStore(doc);
}

/** Apply the same op sequence to both stores and return their final snapshots. */
function runBoth(seq: (s: SlidesStore) => void): { mem: SlidesDocument; yo: SlidesDocument } {
  const mem = new MemSlidesStore();
  const yo = makeYorkie();
  seq(mem);
  seq(yo);
  return { mem: mem.read(), yo: yo.read() };
}

/**
 * Compare two snapshots structurally. Element / slide ids are
 * generated independently per store, so we strip them before comparing
 * to focus on the structural shape: order, frames, types, layout ids.
 */
function stripIds(doc: SlidesDocument): unknown {
  return {
    meta: doc.meta,
    layouts: doc.layouts.map((l) => ({ id: l.id, name: l.name, placeholderCount: l.placeholders.length })),
    slides: doc.slides.map((s) => ({
      layoutId: s.layoutId,
      background: s.background,
      notesLength: s.notes.length,
      elements: s.elements.map((e) => ({
        type: e.type,
        frame: e.frame,
      })),
    })),
  };
}

describe('YorkieSlidesStore ≡ MemSlidesStore (single client, local doc)', () => {
  it('add 3 slides, reorder, remove one', () => {
    const { mem, yo } = runBoth((store) => {
      const ids: string[] = [];
      store.batch(() => {
        for (let i = 0; i < 3; i++) ids.push(store.addSlide(i === 1 ? 'title' : 'blank'));
      });
      store.batch(() => store.moveSlide(ids[2], 0));
      store.batch(() => store.removeSlide(ids[1]));
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    assert.equal(yo.slides.length, 2);
  });

  it('add element, updateElementFrame, reorderElement, remove', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let aId = '';
      let bId = '';
      store.batch(() => { slideId = store.addSlide('blank'); });
      store.batch(() => {
        aId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 10, y: 10, w: 100, h: 60, rotation: 0 },
          data: { kind: 'rect', fill: '#abc' },
        });
        bId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 20, y: 20, w: 100, h: 60, rotation: 0 },
          data: { kind: 'ellipse', fill: '#def' },
        });
      });
      store.batch(() => store.updateElementFrame(slideId, aId, { x: 200 }));
      store.batch(() => store.reorderElement(slideId, aId, 1));
      store.batch(() => store.removeElement(slideId, bId));
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    assert.equal(yo.slides[0].elements.length, 1);
    assert.equal(yo.slides[0].elements[0].frame.x, 200);
  });

  it('applyLayout preserves user-edited elements', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      store.batch(() => { slideId = store.addSlide('blank'); });
      store.batch(() => {
        store.addElement(slideId, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: '#abc' },
        });
      });
      store.batch(() => store.applyLayout(slideId, 'title-body'));
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    // Title-body adds 2 placeholders; user shape preserved → 3 total.
    assert.equal(yo.slides[0].elements.length, 3);
  });

  it('batch / undo / redo round-trip', () => {
    const { mem, yo } = runBoth((store) => {
      store.batch(() => { store.addSlide('blank'); store.addSlide('blank'); });
      store.undo();
      store.redo();
      store.batch(() => store.addSlide('title'));
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    assert.equal(yo.slides.length, 3);
  });

  it('updateSlideBackground stores a deep clone (mem vs yorkie)', () => {
    const { mem, yo } = runBoth((store) => {
      let id = '';
      store.batch(() => { id = store.addSlide('blank'); });
      const bg = { fill: '#ff0000' };
      store.batch(() => store.updateSlideBackground(id, bg));
      bg.fill = '#00ff00'; // mutating the input must not change either store
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
    assert.equal(yo.slides[0].background.fill, '#ff0000');
  });

  it('withTextElement replace-mode round-trip', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let elId = '';
      store.batch(() => {
        slideId = store.addSlide('blank');
        elId = store.addElement(slideId, {
          type: 'text',
          frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
          data: { blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style: {} }] as never },
        });
      });
      store.batch(() => {
        store.withTextElement(slideId, elId, () => [
          { id: 'b2', type: 'paragraph', inlines: [{ text: 'bye', style: {} }], style: {} } as never,
        ]);
      });
    });
    assert.deepEqual(stripIds(yo), stripIds(mem));
  });
});
```

> The `stripIds` shape is deliberately conservative — it compares
> structural facts (order, frames, types) but not generated ids,
> which differ between mem and yorkie. If a future divergence
> appears in some field stripIds doesn't capture, broaden stripIds
> rather than embed magic into the test.

- [ ] **Step 1.2: Run tests, confirm green**

Run: `pnpm --filter @wafflebase/frontend test tests/app/slides/yorkie-slides-equivalence.test.ts`
Expected: PASS — 6 tests.

(You can also run the whole frontend suite to confirm no regressions:
`pnpm --filter @wafflebase/frontend test`.)

- [ ] **Step 1.3: Commit**

```bash
git add packages/frontend/tests/app/slides/yorkie-slides-equivalence.test.ts
git commit -m "Add YorkieSlidesStore equivalence tests" -m "For each interesting op sequence (add/move/remove slides, add/update/
reorder/remove elements, applyLayout that preserves user content,
batch/undo/redo round-trip, updateSlideBackground clone safety,
withTextElement replace), runs the SAME mutations against
MemSlidesStore and YorkieSlidesStore (over a local Yorkie Document)
and asserts the two snapshots match structurally. Single-client only —
two-user convergence is the next test file.

stripIds normalises out the per-store id generation differences so
divergence in shape (order, frames, types) is what fails. Add fields
to stripIds rather than embedding magic into individual cases when a
new structural axis matters.

Refs docs/design/slides/slides.md 'Yorkie schema'."
```

---

## Task 2: Two-user concurrency tests + helper

**Files:**
- Create: `packages/frontend/tests/helpers/two-user-slides-yorkie.ts`
- Create: `packages/frontend/tests/app/slides/yorkie-slides-concurrent.integration.ts`

The helper mirrors `two-user-docs-yorkie.ts` (which is the smaller
sibling of `two-user-yorkie.ts`). It activates two real clients
against the configured Yorkie server, attaches a fresh document on
each, returns `{ storeA, storeB, sync(), cleanup() }`.

The integration test file uses `{ skip: !shouldRun }` so it cleanly
skips on CI / dev machines without a Yorkie server.

- [ ] **Step 2.1: Create the helper**

```ts
// packages/frontend/tests/helpers/two-user-slides-yorkie.ts
import yorkie from '@yorkie-js/sdk';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '@/app/slides/yorkie-slides-store.ts';
import type { YorkieSlidesRoot } from '@/types/slides-document.ts';

type YorkieClient = {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  attach(doc: object, options?: object): Promise<object>;
  detach(doc: object): Promise<object>;
  sync(doc: object): Promise<object[]>;
};

const { Client, Document, SyncMode } = yorkie as {
  Client: new (options?: Record<string, unknown>) => YorkieClient;
  Document: new (key: string) => object;
  SyncMode: { Manual: unknown };
};

function createClient(key: string): YorkieClient {
  return new Client({
    key,
    rpcAddr: process.env.YORKIE_RPC_ADDR ?? 'http://localhost:8080',
    apiKey: process.env.YORKIE_API_KEY,
    syncLoopDuration: 10,
    retrySyncLoopDelay: 10,
    reconnectStreamDelay: 10,
  });
}

/**
 * 4 rounds ensures convergence: each client pushes local changes,
 * pulls the other's changes, pushes any conflict-resolution
 * mutations, and finally pulls those resolutions. Same shape as
 * the docs and sheets two-user helpers.
 */
async function syncClients(
  clients: Array<{ client: YorkieClient; doc: object }>,
): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const { client, doc } of clients) {
      await client.sync(doc);
    }
  }
}

export interface TwoUserSlidesContext {
  storeA: YorkieSlidesStore;
  storeB: YorkieSlidesStore;
  sync(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Spin up two real Yorkie clients sharing a single document key,
 * attach an initialised slides root on each, and return adapters.
 *
 * Usage:
 *   const ctx = await createTwoUserSlides('my-test-slug');
 *   ctx.storeA.batch(() => ctx.storeA.addSlide('blank'));
 *   ctx.storeB.batch(() => ctx.storeB.addSlide('blank'));
 *   await ctx.sync();
 *   // Both stores now see two slides.
 *   await ctx.cleanup();
 */
export async function createTwoUserSlides(
  testName: string,
): Promise<TwoUserSlidesContext> {
  const slug = testName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const docKey = `slides-concurrent-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const clientA = createClient(`slides-a-${slug}`);
  const clientB = createClient(`slides-b-${slug}`);
  await clientA.activate();
  await clientB.activate();

  const docA = new Document(docKey) as yorkie.Document<YorkieSlidesRoot>;
  const docB = new Document(docKey) as yorkie.Document<YorkieSlidesRoot>;

  await clientA.attach(docA, { syncMode: SyncMode.Manual });
  await clientB.attach(docB, { syncMode: SyncMode.Manual });

  // Initialise root on A and propagate to B before either store starts.
  ensureSlidesRoot(docA);
  await syncClients([
    { client: clientA, doc: docA },
    { client: clientB, doc: docB },
  ]);

  const storeA = new YorkieSlidesStore(docA);
  const storeB = new YorkieSlidesStore(docB);

  return {
    storeA,
    storeB,
    async sync() {
      await syncClients([
        { client: clientA, doc: docA },
        { client: clientB, doc: docB },
      ]);
    },
    async cleanup() {
      try {
        await clientA.detach(docA);
        await clientB.detach(docB);
      } finally {
        await clientA.deactivate();
        await clientB.deactivate();
      }
    },
  };
}
```

- [ ] **Step 2.2: Create the integration tests**

```ts
// packages/frontend/tests/app/slides/yorkie-slides-concurrent.integration.ts
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
});
```

> Concurrent test cases stay deliberately small in this first cut.
> The four cases above exercise: independent adds (different rows),
> dependent adds (same slide), update-versus-move (different rows of
> the same Yorkie Object), and remove-versus-add (the spec's "remove
> wins" semantics from the design doc). v2 can broaden coverage.

- [ ] **Step 2.3: Run when Yorkie is up**

```bash
docker compose up -d
YORKIE_RPC_ADDR=http://localhost:8080 pnpm --filter @wafflebase/frontend test:integration
```

Expected: PASS — 4 slides concurrent tests + the existing docs/sheets
concurrent tests all green.

If Yorkie isn't running locally, confirm the suite SKIPS cleanly with
just `pnpm --filter @wafflebase/frontend test:integration` (no env).

- [ ] **Step 2.4: Run `pnpm verify:fast` to confirm no regressions**

The new equivalence tests run inside `verify:fast`; the integration
suite SKIPS unless YORKIE_RPC_ADDR is set, which it isn't in
verify:fast.

Expected: green.

- [ ] **Step 2.5: Commit**

```bash
git add packages/frontend/tests/helpers/two-user-slides-yorkie.ts packages/frontend/tests/app/slides/yorkie-slides-concurrent.integration.ts
git commit -m "Add two-user-slides-yorkie helper and concurrency suite" -m "Helper mirrors two-user-docs-yorkie.ts: activate two real Yorkie
clients against the configured server, attach a fresh shared
document on each, expose storeA/storeB plus a manual sync that runs
4 rounds (the docs/sheets convention).

Concurrent suite covers the four cases the spec's 'Yorkie schema'
section calls out as worth verifying explicitly: independent adds,
dependent adds on the same slide, update-vs-move on the same slide,
and remove-vs-add (where remove wins). The suite skips cleanly when
YORKIE_RPC_ADDR is not set so verify:fast doesn't depend on a
running Yorkie.

Run with:
  docker compose up -d
  YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration

Refs docs/design/slides/slides.md 'Yorkie schema'."
```

---

## Task 3: Tick + plan + push

**Files:**
- Modify: `docs/tasks/active/20260505-slides-package-mvp-todo.md`
- Add: `docs/tasks/active/20260507-slides-phase4b-plan.md` (this file)

- [ ] **Step 3.1: Tick checklist**

In `docs/tasks/active/20260505-slides-package-mvp-todo.md`, mark
items 4.2, 4.8, 4.9 as `[x]`.

> 4.9 (verify:integration green) is satisfied by: the new
> integration tests SKIP without env, so verify:fast stays green;
> WITH env, the tests pass against a running Yorkie. Document the
> exact run command in the commit message so future contributors
> know how to reproduce.

- [ ] **Step 3.2: Commit checklist tick + plan**

```bash
git add docs/tasks/active/20260505-slides-package-mvp-todo.md docs/tasks/active/20260507-slides-phase4b-plan.md
git commit -m "Tick Phase 4b checklist and add plan" -m "4.2 (equivalence), 4.8 (two-user helper + concurrency), and 4.9
(verify:integration green) are complete. Phase 4 is done.

Phase 5 (text IME bridge + presentation mode + PDF export + CLI)
is the next planned phase."
```

- [ ] **Step 3.3: Push**

```bash
git push origin feat/slides-phase1
```

---

## Phase 4b Done

After Task 3:

- `pnpm verify:fast` is green.
- `pnpm --filter @wafflebase/frontend test:integration` is green when
  `YORKIE_RPC_ADDR` is set against a running Yorkie server, and
  skips cleanly without the env.
- Phase 4 of the slides MVP is complete: frontend Yorkie integration
  + multi-user verification.

Phase 5 (text IME bridge, presentation mode, PDF export, CLI, browser
visual scenarios) is the next planned phase.
