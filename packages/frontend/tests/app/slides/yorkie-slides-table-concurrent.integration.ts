/**
 * Concurrent multi-user integration tests for YorkieSlidesStore table
 * ops. Validates that the granular table mutations landed in P5
 * (insertTableRow / insertTableColumn / mergeTableCells /
 * withTableCellBody) converge across two real Yorkie clients.
 *
 * Requires a running Yorkie server:
 *   docker compose up -d
 *   YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTwoUserSlides } from '../../helpers/two-user-slides-yorkie.ts';
import type { YorkieSlidesStore } from '@/app/slides/yorkie-slides-store.ts';

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

// Minimal docs paragraph block — the cell body reuses the docs Block
// schema, and a one-line literal is cheaper than importing a fixture.
const paragraph = (text: string) => ({
  id: 'p1',
  type: 'paragraph' as const,
  inlines: [{ text, style: {} }],
  style: {},
});

/**
 * Seed a fresh `rows × cols` table on a fresh slide via store A and
 * sync it to B. Returns the slide id and table element id, both stores
 * already converged on the empty grid.
 */
async function seedTable(
  ctx: { storeA: YorkieSlidesStore; sync(): Promise<void> },
  rows: number,
  cols: number,
): Promise<{ slideId: string; tableId: string }> {
  let slideId = '';
  let tableId = '';
  ctx.storeA.batch(() => {
    slideId = ctx.storeA.addSlide('blank');
    const colWidth = 100;
    const rowHeight = 40;
    tableId = ctx.storeA.addElement(slideId, {
      type: 'table',
      frame: { x: 0, y: 0, w: colWidth * cols, h: rowHeight * rows, rotation: 0 },
      data: {
        columnWidths: Array(cols).fill(colWidth),
        rows: Array(rows)
          .fill(0)
          .map(() => ({
            height: rowHeight,
            cells: Array(cols)
              .fill(0)
              .map(() => ({ body: { blocks: [] }, style: {} })),
          })),
      },
    });
  });
  await ctx.sync();
  return { slideId, tableId };
}

// Read the inline text of a table cell from a store snapshot.
function cellText(
  store: YorkieSlidesStore,
  slideId: string,
  tableId: string,
  row: number,
  col: number,
): string {
  const slide = store.read().slides.find((s) => s.id === slideId)!;
  const table = slide.elements.find((e) => e.id === tableId)!;
  // Tables read back through the generic `data` branch.
  const data = (table as { data: { rows: Array<{ cells: Array<{ body: { blocks: Array<{ inlines: Array<{ text: string }> }> } }> }> } }).data;
  const blocks = data.rows[row].cells[col].body.blocks;
  return blocks[0]?.inlines[0]?.text ?? '';
}

function tableData(
  store: YorkieSlidesStore,
  slideId: string,
  tableId: string,
): {
  columnWidths: number[];
  rows: Array<{ cells: Array<{ gridSpan?: number; rowSpan?: number }> }>;
} {
  const slide = store.read().slides.find((s) => s.id === slideId)!;
  const table = slide.elements.find((e) => e.id === tableId)!;
  return (table as { data: never }).data;
}

describe('YorkieSlidesStore concurrent table edits', { skip: !shouldRun }, () => {
  it('two clients edit different cells → both edits survive', async () => {
    const ctx = await createTwoUserSlides('table-cell-edit-disjoint');
    try {
      const { slideId, tableId } = await seedTable(ctx, 2, 2);

      ctx.storeA.batch(() =>
        ctx.storeA.withTableCellBody(slideId, tableId, 0, 0, () => [
          paragraph('A00'),
        ]),
      );
      ctx.storeB.batch(() =>
        ctx.storeB.withTableCellBody(slideId, tableId, 1, 1, () => [
          paragraph('B11'),
        ]),
      );
      await ctx.sync();

      for (const store of [ctx.storeA, ctx.storeB]) {
        assert.equal(cellText(store, slideId, tableId, 0, 0), 'A00');
        assert.equal(cellText(store, slideId, tableId, 1, 1), 'B11');
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('two clients append a row each → both rows survive (2 → 4)', async () => {
    const ctx = await createTwoUserSlides('table-row-insert');
    try {
      const { slideId, tableId } = await seedTable(ctx, 2, 2);

      ctx.storeA.batch(() => ctx.storeA.insertTableRow(slideId, tableId, 2));
      ctx.storeB.batch(() => ctx.storeB.insertTableRow(slideId, tableId, 2));
      await ctx.sync();

      const a = tableData(ctx.storeA, slideId, tableId);
      const b = tableData(ctx.storeB, slideId, tableId);
      assert.equal(a.rows.length, 4);
      assert.equal(b.rows.length, 4);
      // Every row keeps the 2-column width.
      for (const row of a.rows) assert.equal(row.cells.length, 2);
      // Same ordering / shape on both peers.
      assert.deepEqual(
        a.rows.map((r) => r.cells.length),
        b.rows.map((r) => r.cells.length),
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('two clients append a column each → both columns survive (2 → 4)', async () => {
    const ctx = await createTwoUserSlides('table-col-insert');
    try {
      const { slideId, tableId } = await seedTable(ctx, 2, 2);

      ctx.storeA.batch(() => ctx.storeA.insertTableColumn(slideId, tableId, 2));
      ctx.storeB.batch(() => ctx.storeB.insertTableColumn(slideId, tableId, 2));
      await ctx.sync();

      const a = tableData(ctx.storeA, slideId, tableId);
      const b = tableData(ctx.storeB, slideId, tableId);
      assert.equal(a.columnWidths.length, 4);
      assert.equal(b.columnWidths.length, 4);
      // Each row's cell count tracks the widened grid on both peers.
      for (const row of a.rows) assert.equal(row.cells.length, 4);
      for (const row of b.rows) assert.equal(row.cells.length, 4);
    } finally {
      await ctx.cleanup();
    }
  });

  it('A merges a cell range while B edits a disjoint cell → both apply', async () => {
    const ctx = await createTwoUserSlides('table-merge-vs-edit');
    try {
      const { slideId, tableId } = await seedTable(ctx, 2, 2);

      // A merges the top row (0,0)-(0,1); B types into a bottom cell.
      ctx.storeA.batch(() =>
        ctx.storeA.mergeTableCells(slideId, tableId, {
          r0: 0,
          c0: 0,
          r1: 0,
          c1: 1,
        }),
      );
      ctx.storeB.batch(() =>
        ctx.storeB.withTableCellBody(slideId, tableId, 1, 0, () => [
          paragraph('B10'),
        ]),
      );
      await ctx.sync();

      for (const store of [ctx.storeA, ctx.storeB]) {
        const data = tableData(store, slideId, tableId);
        // Merge anchor spans two columns; the covered cell is marked 0.
        assert.equal(data.rows[0].cells[0].gridSpan, 2);
        assert.equal(data.rows[0].cells[1].gridSpan, 0);
        // The concurrent edit on the disjoint bottom cell survives.
        assert.equal(cellText(store, slideId, tableId, 1, 0), 'B10');
      }
    } finally {
      await ctx.cleanup();
    }
  });
});
