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

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

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

      // Both clients should see the same result
      const textA = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      const textB = docB.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      assert.equal(textA, textB, `Divergence detected: A="${textA}" B="${textB}"`);

      // Both "XXX" insertion and split should be preserved.
      console.log(`  split+insert converged text: "${textA}" (${docA.blocks.length} blocks)`);
      assert.ok(docA.blocks.length >= 2, `Split should produce at least 2 blocks, got ${docA.blocks.length}`);
      const fullText = textA.replace(/\|/g, '');
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

      const textA = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      const textB = docB.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      assert.equal(textA, textB, `Divergence detected: A="${textA}" B="${textB}"`);

      // Both splits should be preserved — at least 3 blocks
      assert.ok(docA.blocks.length >= 3, `Expected ≥3 blocks, got ${docA.blocks.length}`);
      const fullText = textA.replace(/\|/g, '');
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

      const textA = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      const textB = docB.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      assert.equal(textA, textB, `Divergence detected: A="${textA}" B="${textB}"`);

      // Both merge and insertion should be preserved
      const fullText = textA.replace(/\|/g, '');
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

      const textA = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      const textB = docB.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      assert.equal(textA, textB, `Divergence detected: A="${textA}" B="${textB}"`);

      // All text should be preserved
      const fullText = textA.replace(/\|/g, '');
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

      const textA = docA.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      const textB = docB.blocks.map((b) => b.inlines.map((i) => i.text).join('')).join('|');
      assert.equal(textA, textB, `Divergence detected: A="${textA}" B="${textB}"`);

      // "Hello" and "ld" should survive, "Wor" should be deleted
      const fullText = textA.replace(/\|/g, '');
      assert.ok(fullText.includes('Hello'), '"Hello" should be preserved');
      assert.ok(fullText.includes('ld'), '"ld" should be preserved');
      assert.ok(!fullText.includes('Wor'), '"Wor" should be deleted');
    } finally {
      await ctx.cleanup();
    }
  });
});
