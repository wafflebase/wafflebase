# Inline Style Automated Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automated tests for native CRDT inline styling — single-user edge cases in unit tests, concurrent scenarios in integration tests, then delete the raw spike integration file.

**Architecture:** Extend two existing test files: `yorkie-doc-store.test.ts` for single-user scenarios (no server needed), `yorkie-doc-store-concurrent.integration.ts` for two-client concurrent scenarios (Yorkie server needed). Delete `native-inline-style-concurrent.integration.ts` since it tests raw Tree API rather than the `YorkieDocStore` API.

**Tech Stack:** node:test, node:assert/strict, Yorkie JS SDK 0.7.6, `createTwoUserDocs` helper

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts` | Modify | Add single-user applyStyle edge case tests |
| `packages/frontend/tests/app/docs/yorkie-doc-store-concurrent.integration.ts` | Modify | Add concurrent style tests (6 scenarios) |
| `packages/frontend/tests/app/docs/native-inline-style-concurrent.integration.ts` | Delete | Raw Tree API spike — superseded |

---

### Task 1: Add single-user applyStyle edge case tests

**Files:**
- Modify: `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`

Add two test cases to the existing `describe('applyStyle')` block (after line 517).

- [ ] **Step 1: Add toggle-off and type-in-styled-region tests**

Append inside the existing `describe('applyStyle', () => { ... })` block:

```typescript
    it('should toggle bold off when re-applied to same range', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 3, { bold: true });
      // Now un-bold "Hel"
      store.applyStyle(block.id, 0, 3, { bold: false });
      const result = store.getBlock(block.id)!;
      assert.equal(result.inlines.length, 1);
      assert.equal(result.inlines[0].text, 'Hello');
      assert.equal(result.inlines[0].style.bold, false);
    });

    it('should preserve bold for text inserted inside bold region', () => {
      const block = makeBlock('Hello');
      store.setDocument({ blocks: [block] });
      store.applyStyle(block.id, 0, 5, { bold: true });
      store.insertText(block.id, 3, 'XX');
      const result = store.getBlock(block.id)!;
      const fullText = result.inlines.map((i) => i.text).join('');
      assert.equal(fullText, 'HelXXlo');
      // All text should be bold since insertion inherits the inline style
      for (const inline of result.inlines) {
        assert.equal(inline.style.bold, true, `"${inline.text}" should be bold`);
      }
    });
```

- [ ] **Step 2: Run tests**

Run: `node --experimental-strip-types --import ./packages/frontend/tests/register-hooks.mjs --test --test-name-pattern "applyStyle" packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`
Expected: All 8 tests PASS (6 existing + 2 new)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/tests/app/docs/yorkie-doc-store.test.ts
git commit -m "Add applyStyle edge case tests: toggle-off and styled insert"
```

---

### Task 2: Add concurrent inline style integration tests

**Files:**
- Modify: `packages/frontend/tests/app/docs/yorkie-doc-store-concurrent.integration.ts`

Add a new `describe` block for concurrent styling scenarios after the existing `describe('YorkieDocStore concurrent split/merge')`.

- [ ] **Step 1: Add concurrent style test suite**

Append at the end of the file (after the closing `});` of the existing describe block):

```typescript

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
```

- [ ] **Step 2: Run concurrent integration tests**

Run: `YORKIE_RPC_ADDR=http://localhost:8080 node --experimental-strip-types --test packages/frontend/tests/app/docs/yorkie-doc-store-concurrent.integration.ts`
Expected: All tests PASS (5 existing split/merge + 6 new styling)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/tests/app/docs/yorkie-doc-store-concurrent.integration.ts
git commit -m "Add concurrent inline style integration tests

Cover: text insert+style, non-overlapping styles, overlapping styles,
text delete+style, and style+block split convergence."
```

---

### Task 3: Delete raw spike integration test

**Files:**
- Delete: `packages/frontend/tests/app/docs/native-inline-style-concurrent.integration.ts`

- [ ] **Step 1: Delete spike file**

```bash
rm packages/frontend/tests/app/docs/native-inline-style-concurrent.integration.ts
```

- [ ] **Step 2: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git rm packages/frontend/tests/app/docs/native-inline-style-concurrent.integration.ts
git commit -m "Remove raw Tree API inline style spike test

Superseded by YorkieDocStore-level concurrent tests in
yorkie-doc-store-concurrent.integration.ts."
```
