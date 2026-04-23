/**
 * Concurrent split/merge integration tests for YorkieDocStore.
 *
 * These tests verify that native Yorkie Tree split/merge operations
 * converge correctly when two clients edit the same document concurrently.
 *
 * Requires a running Yorkie server:
 *   docker compose up -d
 *   YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTwoUserDocs, makeBlock } from '../../helpers/two-user-docs-yorkie.ts';
import { generateBlockId, createTableBlock } from '@wafflebase/docs';
import type { Block } from '@wafflebase/docs';

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

/** Normalize blocks to a canonical shape for structural comparison. */
function normalizeBlocks(blocks: Block[]) {
  return blocks.map((b) => ({
    type: b.type,
    headingLevel: b.headingLevel,
    listKind: b.listKind,
    listLevel: b.listLevel,
    text: b.inlines.map((i) => i.text).join(''),
  }));
}

describe('YorkieDocStore concurrent split/merge', { skip: !shouldRun }, () => {

  // -------------------------------------------------------------------------
  // Concurrent split + text insert
  // -------------------------------------------------------------------------

  it('concurrent split and text insert should converge', async () => {
    const block = makeBlock('HelloWorld');
    const ctx = await createTwoUserDocs('split-and-insert', [block]);
    try {
      // Client A: split the block at offset 5 (Enter key)
      ctx.storeA.splitBlock(block.id, 5, generateBlockId(), 'paragraph');

      // Client B: insert text at offset 3 (typing in the same paragraph)
      ctx.storeB.insertText(block.id, 3, 'XXX');

      // Sync and check convergence
      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      // Both clients should see the same structural result
      assert.deepEqual(normalizeBlocks(docA.blocks), normalizeBlocks(docB.blocks), 'Structural divergence');

      // Both "XXX" insertion and split should be preserved
      assert.ok(docA.blocks.length >= 2, `Split should produce at least 2 blocks, got ${docA.blocks.length}`);
      const fullText = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.equal(fullText.length, 'HelloWorld'.length + 'XXX'.length, `Expected 13 chars, got "${fullText}"`);
      assert.ok(fullText.includes('XXX'), `Inserted text "XXX" should be preserved, got "${fullText}"`);
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Concurrent split + split (same paragraph)
  // -------------------------------------------------------------------------

  it('two users splitting the same paragraph should converge', async () => {
    const block = makeBlock('ABCDEFGH');
    const ctx = await createTwoUserDocs('split-and-split', [block]);
    try {
      // Client A: split at offset 2 ("AB" | "CDEFGH")
      ctx.storeA.splitBlock(block.id, 2, generateBlockId(), 'paragraph');

      // Client B: split at offset 6 ("ABCDEF" | "GH")
      ctx.storeB.splitBlock(block.id, 6, generateBlockId(), 'paragraph');

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      assert.deepEqual(normalizeBlocks(docA.blocks), normalizeBlocks(docB.blocks), 'Structural divergence');

      // Both splits should be preserved — at least 3 blocks
      assert.ok(docA.blocks.length >= 3, `Expected ≥3 blocks, got ${docA.blocks.length}`);
      const fullText = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.equal(fullText, 'ABCDEFGH', 'All text should be preserved');
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Concurrent merge + text insert
  // -------------------------------------------------------------------------

  it('concurrent merge and text insert should converge', async () => {
    const b1 = makeBlock('Hello');
    const b2 = makeBlock('World');
    const ctx = await createTwoUserDocs('merge-and-insert', [b1, b2]);
    try {
      // Client A: merge the two blocks (Backspace at start of block 2)
      ctx.storeA.mergeBlock(b1.id, b2.id);

      // Client B: insert text into block 2
      ctx.storeB.insertText(b2.id, 0, 'XXX');

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      assert.deepEqual(normalizeBlocks(docA.blocks), normalizeBlocks(docB.blocks), 'Structural divergence');

      // Both merge and insertion should be preserved
      const fullText = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.ok(fullText.includes('Hello'), '"Hello" should be preserved');
      assert.ok(fullText.includes('World'), '"World" should be preserved');
      assert.ok(fullText.includes('XXX'), '"XXX" insertion should be preserved');
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Concurrent split + merge on adjacent blocks
  // -------------------------------------------------------------------------

  it('concurrent split and merge on adjacent blocks should converge', async () => {
    const b1 = makeBlock('First');
    const b2 = makeBlock('Second');
    const b3 = makeBlock('Third');
    const ctx = await createTwoUserDocs('split-and-merge', [b1, b2, b3]);
    try {
      // Client A: split block 1 at offset 3 ("Fir" | "st")
      ctx.storeA.splitBlock(b1.id, 3, generateBlockId(), 'paragraph');

      // Client B: merge block 2 and 3 ("SecondThird")
      ctx.storeB.mergeBlock(b2.id, b3.id);

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      assert.deepEqual(normalizeBlocks(docA.blocks), normalizeBlocks(docB.blocks), 'Structural divergence');

      // All text should be preserved
      const fullText = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.ok(fullText.includes('First'), '"First" should be preserved');
      assert.ok(fullText.includes('Second'), '"Second" should be preserved');
      assert.ok(fullText.includes('Third'), '"Third" should be preserved');
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Concurrent split + delete text
  // -------------------------------------------------------------------------

  it('concurrent split and text delete should converge', async () => {
    const block = makeBlock('HelloWorld');
    const ctx = await createTwoUserDocs('split-and-delete', [block]);
    try {
      // Client A: split at offset 5
      ctx.storeA.splitBlock(block.id, 5, generateBlockId(), 'paragraph');

      // Client B: delete "Wor" (offset 5, length 3)
      ctx.storeB.deleteText(block.id, 5, 3);

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      assert.deepEqual(normalizeBlocks(docA.blocks), normalizeBlocks(docB.blocks), 'Structural divergence');

      // "Hello" and "ld" should survive, "Wor" should be deleted
      const fullText = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.ok(fullText.includes('Hello'), '"Hello" should be preserved');
      assert.ok(fullText.includes('ld'), '"ld" should be preserved');
      assert.ok(!fullText.includes('Wor'), '"Wor" should be deleted');
    } finally {
      await ctx.cleanup();
    }
  });
});

/** Collect all inline text+style from a document for comparison. */
function describeDoc(blocks: Block[]) {
  return blocks.map((b) => ({
    text: b.inlines.map((i) => i.text).join(''),
    inlines: b.inlines.map((i) => ({ text: i.text, bold: i.style.bold, italic: i.style.italic })),
  }));
}

describe('YorkieDocStore concurrent inline styling', { skip: !shouldRun }, () => {

  // -------------------------------------------------------------------------
  // 2-1. Concurrent text insert + style (the key improvement)
  // -------------------------------------------------------------------------

  it('concurrent text insert and bold should both be preserved', async () => {
    const block = makeBlock('HelloWorld');
    const ctx = await createTwoUserDocs('insert-and-style', [block]);
    try {
      // Client A: bold "World" (offset 5..10)
      ctx.storeA.applyStyle(block.id, 5, 10, { bold: true });

      // Client B: insert "Hey " at offset 0
      ctx.storeB.insertText(block.id, 0, 'Hey ');

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      // Convergence
      const textA = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      const textB = docB.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.equal(textA, textB, 'Text divergence');

      // Both operations preserved
      assert.ok(textA.includes('Hey '), '"Hey " insertion should be preserved');
      assert.equal(textA.length, 14, 'All 14 chars should exist');

      // Bold should still be on "World"
      const boldText = docA.blocks[0].inlines
        .filter((i) => i.style.bold === true)
        .map((i) => i.text)
        .join('');
      assert.ok(boldText.includes('World'), `Bold text should contain "World", got "${boldText}"`);
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // 2-2. Concurrent text insert at end + style at start
  // -------------------------------------------------------------------------

  it('concurrent style at start and text insert at end should both be preserved', async () => {
    const block = makeBlock('HelloWorld');
    const ctx = await createTwoUserDocs('style-start-insert-end', [block]);
    try {
      // Client A: italic "Hello" (offset 0..5)
      ctx.storeA.applyStyle(block.id, 0, 5, { italic: true });

      // Client B: insert "!!" at offset 10
      ctx.storeB.insertText(block.id, 10, '!!');

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      const textA = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      const textB = docB.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.equal(textA, textB, 'Text divergence');
      assert.ok(textA.includes('!!'), '"!!" should be preserved');

      const italicText = docA.blocks[0].inlines
        .filter((i) => i.style.italic === true)
        .map((i) => i.text)
        .join('');
      assert.ok(italicText.includes('Hello'), `Italic text should contain "Hello", got "${italicText}"`);
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // 3-1. Concurrent non-overlapping styles
  // -------------------------------------------------------------------------

  it('concurrent non-overlapping styles should both be applied', async () => {
    const block = makeBlock('HelloWorld');
    const ctx = await createTwoUserDocs('style-non-overlap', [block]);
    try {
      // Client A: bold "Hello" (offset 0..5)
      ctx.storeA.applyStyle(block.id, 0, 5, { bold: true });

      // Client B: italic "World" (offset 5..10)
      ctx.storeB.applyStyle(block.id, 5, 10, { italic: true });

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      // Convergence: same text
      const textA = docA.blocks[0].inlines.map((i) => i.text).join('');
      const textB = docB.blocks[0].inlines.map((i) => i.text).join('');
      assert.equal(textA, textB, 'Text divergence');
      assert.equal(textA, 'HelloWorld');

      // Both styles should be present
      const boldText = docA.blocks[0].inlines
        .filter((i) => i.style.bold === true)
        .map((i) => i.text)
        .join('');
      const italicText = docA.blocks[0].inlines
        .filter((i) => i.style.italic === true)
        .map((i) => i.text)
        .join('');
      assert.ok(boldText.length > 0, 'Bold should be preserved');
      assert.ok(italicText.length > 0, 'Italic should be preserved');
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // 3-2. Concurrent overlapping styles
  // -------------------------------------------------------------------------

  it('concurrent overlapping styles should converge', async () => {
    const block = makeBlock('HelloWorld');
    const ctx = await createTwoUserDocs('style-overlap', [block]);
    try {
      // Client A: bold "HelloWo" (offset 0..7)
      ctx.storeA.applyStyle(block.id, 0, 7, { bold: true });

      // Client B: italic "loWorld" (offset 3..10)
      ctx.storeB.applyStyle(block.id, 3, 10, { italic: true });

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      const textA = docA.blocks[0].inlines.map((i) => i.text).join('');
      const textB = docB.blocks[0].inlines.map((i) => i.text).join('');
      assert.equal(textA, textB, 'Text divergence');
      assert.equal(textA, 'HelloWorld');

      // Structural convergence
      assert.deepEqual(describeDoc(docA.blocks), describeDoc(docB.blocks), 'Inline structure divergence');
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // 4-1. Concurrent text delete + style
  // -------------------------------------------------------------------------

  it('concurrent text delete and style should both be preserved', async () => {
    const block = makeBlock('HelloWorld');
    const ctx = await createTwoUserDocs('delete-and-style', [block]);
    try {
      // Client A: bold "World" (offset 5..10)
      ctx.storeA.applyStyle(block.id, 5, 10, { bold: true });

      // Client B: delete "lo" (offset 3, length 2)
      ctx.storeB.deleteText(block.id, 3, 2);

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      const textA = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      const textB = docB.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.equal(textA, textB, 'Text divergence');
      assert.equal(textA, 'HelWorld', '"lo" should be deleted');

      const boldText = docA.blocks[0].inlines
        .filter((i) => i.style.bold === true)
        .map((i) => i.text)
        .join('');
      assert.ok(boldText.includes('World'), `Bold should be on "World", got "${boldText}"`);
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // 5-1. Concurrent style + block split (Enter)
  // -------------------------------------------------------------------------

  it('concurrent style and block split should converge', async () => {
    const block = makeBlock('HelloWorld');
    const ctx = await createTwoUserDocs('style-and-split', [block]);
    try {
      // Client A: bold "Hello" (offset 0..5)
      ctx.storeA.applyStyle(block.id, 0, 5, { bold: true });

      // Client B: split at offset 5 (Enter between "Hello" and "World")
      ctx.storeB.splitBlock(block.id, 5, generateBlockId(), 'paragraph');

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      // Both should see at least 2 blocks
      assert.ok(docA.blocks.length >= 2, `Expected ≥2 blocks, got ${docA.blocks.length}`);

      // Convergence
      assert.deepEqual(normalizeBlocks(docA.blocks), normalizeBlocks(docB.blocks), 'Structural divergence');

      // All text preserved
      const fullText = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('');
      assert.equal(fullText, 'HelloWorld', 'All text should be preserved');
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Table cell concurrent editing
// ---------------------------------------------------------------------------

function getCellText(blocks: Block[], tableIdx: number, rowIdx: number, colIdx: number): string {
  const table = blocks[tableIdx];
  const cell = table.tableData!.rows[rowIdx].cells[colIdx];
  return cell.blocks.flatMap((b) => b.inlines.map((i) => i.text)).join('');
}

describe('YorkieDocStore concurrent table cell edits', { skip: !shouldRun }, () => {

  it('concurrent text inserts in same cell should merge', async () => {
    const table = createTableBlock(2, 2);
    const cellBlock = table.tableData!.rows[0].cells[0].blocks[0];
    cellBlock.inlines = [{ text: 'Hello', style: {} }];
    const ctx = await createTwoUserDocs('cell-insert-insert', [table]);
    try {
      // Client A: insert at start
      ctx.storeA.insertText(cellBlock.id, 0, 'A');
      // Client B: insert at end
      ctx.storeB.insertText(cellBlock.id, 5, 'B');

      await ctx.sync();

      const textA = getCellText(ctx.storeA.getDocument().blocks, 0, 0, 0);
      const textB = getCellText(ctx.storeB.getDocument().blocks, 0, 0, 0);
      assert.equal(textA, textB, 'Both clients should converge');
      assert.equal(textA.length, 7, 'Both inserts should be preserved');
      assert.ok(textA.includes('A'), 'Insert A preserved');
      assert.ok(textA.includes('B'), 'Insert B preserved');
    } finally {
      await ctx.cleanup();
    }
  });

  it('concurrent edits in different cells should not conflict', async () => {
    const table = createTableBlock(2, 2);
    const cell00 = table.tableData!.rows[0].cells[0].blocks[0];
    const cell11 = table.tableData!.rows[1].cells[1].blocks[0];
    cell00.inlines = [{ text: 'AAA', style: {} }];
    cell11.inlines = [{ text: 'BBB', style: {} }];
    const ctx = await createTwoUserDocs('cell-different-cells', [table]);
    try {
      // Client A edits cell [0][0]
      ctx.storeA.insertText(cell00.id, 3, '111');
      // Client B edits cell [1][1]
      ctx.storeB.insertText(cell11.id, 3, '222');

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();
      assert.equal(getCellText(docA.blocks, 0, 0, 0), 'AAA111');
      assert.equal(getCellText(docA.blocks, 0, 1, 1), 'BBB222');
      assert.equal(getCellText(docB.blocks, 0, 0, 0), 'AAA111');
      assert.equal(getCellText(docB.blocks, 0, 1, 1), 'BBB222');
    } finally {
      await ctx.cleanup();
    }
  });

  it('concurrent text insert and bold in same cell should both be preserved', async () => {
    const table = createTableBlock(1, 1);
    const cellBlock = table.tableData!.rows[0].cells[0].blocks[0];
    cellBlock.inlines = [{ text: 'HelloWorld', style: {} }];
    const ctx = await createTwoUserDocs('cell-insert-style', [table]);
    try {
      // Client A: bold "World" (offset 5..10)
      ctx.storeA.applyStyle(cellBlock.id, 5, 10, { bold: true });
      // Client B: insert text at offset 3
      ctx.storeB.insertText(cellBlock.id, 3, 'XX');

      await ctx.sync();

      const textA = getCellText(ctx.storeA.getDocument().blocks, 0, 0, 0);
      const textB = getCellText(ctx.storeB.getDocument().blocks, 0, 0, 0);
      assert.equal(textA, textB, 'Both clients should converge');
      assert.equal(textA.length, 12, 'Insert should be preserved');
      assert.ok(textA.includes('XX'), 'Inserted text preserved');
    } finally {
      await ctx.cleanup();
    }
  });

  it('concurrent split in cell and text insert in same cell should converge', async () => {
    const table = createTableBlock(1, 1);
    const cellBlock = table.tableData!.rows[0].cells[0].blocks[0];
    cellBlock.inlines = [{ text: 'HelloWorld', style: {} }];
    const ctx = await createTwoUserDocs('cell-split-insert', [table]);
    try {
      // Client A: split at offset 5 (Enter key in cell)
      ctx.storeA.splitBlock(cellBlock.id, 5, generateBlockId(), 'paragraph');
      // Client B: insert text at offset 3
      ctx.storeB.insertText(cellBlock.id, 3, 'XX');

      await ctx.sync();

      // Both clients should converge
      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();
      const cellA = docA.blocks[0].tableData!.rows[0].cells[0];
      const cellB = docB.blocks[0].tableData!.rows[0].cells[0];

      const fullTextA = cellA.blocks.flatMap((b) => b.inlines.map((i) => i.text)).join('');
      const fullTextB = cellB.blocks.flatMap((b) => b.inlines.map((i) => i.text)).join('');
      assert.equal(fullTextA, fullTextB, 'Text should converge');
      assert.ok(cellA.blocks.length >= 2, 'Split should produce ≥2 blocks in cell');
      assert.equal(fullTextA.length, 12, 'Both insert and split should be preserved');
      assert.ok(fullTextA.includes('XX'), 'Inserted text should be preserved');
    } finally {
      await ctx.cleanup();
    }
  });
});
