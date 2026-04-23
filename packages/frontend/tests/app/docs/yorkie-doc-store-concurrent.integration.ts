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
import { generateBlockId } from '@wafflebase/docs';
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
