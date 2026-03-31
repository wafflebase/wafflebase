/**
 * Integration tests for docs undo/redo with Yorkie Tree CRDT.
 *
 * Tests two-client concurrent editing scenarios to verify that
 * undo/redo operations don't corrupt the document (no duplicate
 * block IDs, no CRDT position errors).
 *
 * Requires a running Yorkie server:
 *   YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createTwoUserDocs,
  makeBlock,
  getBlockText,
  getAllBlockTexts,
  type TwoUserDocsContext,
} from "../../helpers/two-user-docs-yorkie.ts";

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

describe("Docs Undo/Redo Integration", { skip: !shouldRun }, () => {
  let ctx: TwoUserDocsContext;

  afterEach(async () => {
    if (ctx) await ctx.cleanup();
  });

  // -----------------------------------------------------------------------
  // 1. Single-client undo/redo basics
  // -----------------------------------------------------------------------

  it("single client: type then undo restores original", async () => {
    ctx = await createTwoUserDocs("single-type-undo", [makeBlock("init")]);

    const { storeA } = ctx;
    const doc = storeA.getDocument();
    const blockId = doc.blocks[0].id;

    // Type "Hello" via batch
    storeA.beginBatch();
    storeA.updateBlock(blockId, {
      ...doc.blocks[0],
      inlines: [{ text: "Hello", style: {} }],
    });
    storeA.endBatch();

    assert.equal(getBlockText(storeA, 0), "Hello");

    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "init");

    storeA.redo();
    assert.equal(getBlockText(storeA, 0), "Hello");
  });

  it("single client: multiple undos", async () => {
    ctx = await createTwoUserDocs("multi-undo", [makeBlock("")]);

    const { storeA } = ctx;

    // Batch 1: type "a"
    const doc1 = storeA.getDocument();
    storeA.beginBatch();
    storeA.updateBlock(doc1.blocks[0].id, {
      ...doc1.blocks[0],
      inlines: [{ text: "a", style: {} }],
    });
    storeA.endBatch();

    // Batch 2: type "ab"
    const doc2 = storeA.getDocument();
    storeA.beginBatch();
    storeA.updateBlock(doc2.blocks[0].id, {
      ...doc2.blocks[0],
      inlines: [{ text: "ab", style: {} }],
    });
    storeA.endBatch();

    // Batch 3: type "abc"
    const doc3 = storeA.getDocument();
    storeA.beginBatch();
    storeA.updateBlock(doc3.blocks[0].id, {
      ...doc3.blocks[0],
      inlines: [{ text: "abc", style: {} }],
    });
    storeA.endBatch();

    assert.equal(getBlockText(storeA, 0), "abc");

    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "ab");

    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "a");

    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "");
  });

  // -----------------------------------------------------------------------
  // 2. Compound operations: split/merge as single undo unit
  // -----------------------------------------------------------------------

  it("single client: split block undoes in one step", async () => {
    ctx = await createTwoUserDocs("split-undo", [makeBlock("HelloWorld")]);

    const { storeA } = ctx;
    const doc = storeA.getDocument();
    const blockId = doc.blocks[0].id;

    // Split at offset 5: "Hello" | "World"
    storeA.beginBatch();
    storeA.updateBlock(blockId, {
      ...doc.blocks[0],
      inlines: [{ text: "Hello", style: {} }],
    });
    storeA.insertBlock(1, makeBlock("World"));
    storeA.endBatch();

    assert.equal(storeA.getDocument().blocks.length, 2);
    assert.equal(getBlockText(storeA, 0), "Hello");
    assert.equal(getBlockText(storeA, 1), "World");

    // Single undo should restore both blocks
    storeA.undo();
    assert.equal(storeA.getDocument().blocks.length, 1);
    assert.equal(getBlockText(storeA, 0), "HelloWorld");
  });

  it("single client: merge blocks undoes in one step", async () => {
    ctx = await createTwoUserDocs("merge-undo", [
      makeBlock("Hello"),
      makeBlock("World"),
    ]);

    const { storeA } = ctx;
    const doc = storeA.getDocument();

    // Merge: "Hello" + "World" → "HelloWorld"
    storeA.beginBatch();
    storeA.updateBlock(doc.blocks[0].id, {
      ...doc.blocks[0],
      inlines: [{ text: "HelloWorld", style: {} }],
    });
    storeA.deleteBlock(doc.blocks[1].id);
    storeA.endBatch();

    assert.equal(storeA.getDocument().blocks.length, 1);
    assert.equal(getBlockText(storeA, 0), "HelloWorld");

    // Single undo should restore both blocks
    storeA.undo();
    assert.equal(storeA.getDocument().blocks.length, 2);
    assert.equal(getBlockText(storeA, 0), "Hello");
    assert.equal(getBlockText(storeA, 1), "World");
  });

  // -----------------------------------------------------------------------
  // 3. Two-client concurrent editing + undo
  // -----------------------------------------------------------------------

  it("two clients: A edits block 0, B edits block 1, both undo", async () => {
    ctx = await createTwoUserDocs("two-client-diff-blocks", [
      makeBlock("para1"),
      makeBlock("para2"),
    ]);

    const { storeA, storeB, sync } = ctx;

    // Sync initial state
    await sync();

    const docA = storeA.getDocument();
    const docB = storeB.getDocument();

    // A edits block 0: "para1" → "abcd"
    storeA.beginBatch();
    storeA.updateBlock(docA.blocks[0].id, {
      ...docA.blocks[0],
      inlines: [{ text: "abcd", style: {} }],
    });
    storeA.endBatch();

    // B edits block 1: "para2" → "qwer"
    storeB.beginBatch();
    storeB.updateBlock(docB.blocks[1].id, {
      ...docB.blocks[1],
      inlines: [{ text: "qwer", style: {} }],
    });
    storeB.endBatch();

    // Sync changes
    await sync();

    // Both should see the merged result
    assert.deepEqual(getAllBlockTexts(storeA), ["abcd", "qwer"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["abcd", "qwer"]);

    // A undoes → block 0 back to "para1", block 1 stays "qwer"
    storeA.undo();
    await sync();

    assert.deepEqual(getAllBlockTexts(storeA), ["para1", "qwer"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["para1", "qwer"]);

    // B undoes → block 1 back to "para2"
    storeB.undo();
    await sync();

    assert.deepEqual(getAllBlockTexts(storeA), ["para1", "para2"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["para1", "para2"]);
  });

  it("two clients: A edits block 0, B edits block 1, A undoes then redoes", async () => {
    ctx = await createTwoUserDocs("two-client-undo-redo", [
      makeBlock("para1"),
      makeBlock("para2"),
    ]);

    const { storeA, storeB, sync } = ctx;
    await sync();

    const docA = storeA.getDocument();
    const docB = storeB.getDocument();

    // A: "para1" → "AAAA"
    storeA.beginBatch();
    storeA.updateBlock(docA.blocks[0].id, {
      ...docA.blocks[0],
      inlines: [{ text: "AAAA", style: {} }],
    });
    storeA.endBatch();

    // B: "para2" → "BBBB"
    storeB.beginBatch();
    storeB.updateBlock(docB.blocks[1].id, {
      ...docB.blocks[1],
      inlines: [{ text: "BBBB", style: {} }],
    });
    storeB.endBatch();

    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["AAAA", "BBBB"]);

    // A undoes
    storeA.undo();
    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["para1", "BBBB"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["para1", "BBBB"]);

    // A redoes
    storeA.redo();
    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["AAAA", "BBBB"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["AAAA", "BBBB"]);
  });

  it("two clients: alternating undo — A undoes, then B undoes", async () => {
    ctx = await createTwoUserDocs("alternating-undo", [
      makeBlock("original1"),
      makeBlock("original2"),
    ]);

    const { storeA, storeB, sync } = ctx;
    await sync();

    const docA = storeA.getDocument();
    const docB = storeB.getDocument();

    // A edits block 0
    storeA.beginBatch();
    storeA.updateBlock(docA.blocks[0].id, {
      ...docA.blocks[0],
      inlines: [{ text: "editA", style: {} }],
    });
    storeA.endBatch();

    await sync();

    // B edits block 1
    storeB.beginBatch();
    storeB.updateBlock(docB.blocks[1].id, {
      ...docB.blocks[1],
      inlines: [{ text: "editB", style: {} }],
    });
    storeB.endBatch();

    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["editA", "editB"]);

    // A undoes its edit
    storeA.undo();
    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["original1", "editB"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["original1", "editB"]);

    // B undoes its edit
    storeB.undo();
    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["original1", "original2"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["original1", "original2"]);
  });

  // -----------------------------------------------------------------------
  // 4. No duplicate block IDs after undo
  // -----------------------------------------------------------------------

  it("no duplicate block IDs after concurrent edit + undo", async () => {
    ctx = await createTwoUserDocs("no-dup-ids", [
      makeBlock("first"),
      makeBlock("second"),
    ]);

    const { storeA, storeB, sync } = ctx;
    await sync();

    const docA = storeA.getDocument();

    // A edits block 0
    storeA.beginBatch();
    storeA.updateBlock(docA.blocks[0].id, {
      ...docA.blocks[0],
      inlines: [{ text: "changed", style: {} }],
    });
    storeA.endBatch();

    // B also edits (different block)
    const docB = storeB.getDocument();
    storeB.beginBatch();
    storeB.updateBlock(docB.blocks[1].id, {
      ...docB.blocks[1],
      inlines: [{ text: "also changed", style: {} }],
    });
    storeB.endBatch();

    await sync();

    // A undoes
    storeA.undo();
    await sync();

    // Check no duplicate IDs on either client
    for (const store of [storeA, storeB]) {
      const doc = store.getDocument();
      const ids = doc.blocks.map((b) => b.id);
      const unique = new Set(ids);
      assert.equal(
        ids.length,
        unique.size,
        `Duplicate block IDs found: ${JSON.stringify(ids)}`,
      );
    }
  });

  // -----------------------------------------------------------------------
  // 5. Block insertion + undo convergence
  // -----------------------------------------------------------------------

  it("two clients: A inserts block, B edits existing, A undoes", async () => {
    ctx = await createTwoUserDocs("insert-and-edit", [makeBlock("original")]);

    const { storeA, storeB, sync } = ctx;
    await sync();

    // A inserts a new block
    storeA.beginBatch();
    storeA.insertBlock(1, makeBlock("inserted by A"));
    storeA.endBatch();

    // B edits the existing block
    const docB = storeB.getDocument();
    storeB.beginBatch();
    storeB.updateBlock(docB.blocks[0].id, {
      ...docB.blocks[0],
      inlines: [{ text: "edited by B", style: {} }],
    });
    storeB.endBatch();

    await sync();

    // A undoes the insertion
    storeA.undo();
    await sync();

    // Both should converge: B's edit preserved, A's insertion gone
    const textsA = getAllBlockTexts(storeA);
    const textsB = getAllBlockTexts(storeB);
    assert.deepEqual(textsA, textsB, "Clients should converge after undo");
    assert.ok(
      textsA.includes("edited by B"),
      "B's edit should be preserved",
    );
  });

  // -----------------------------------------------------------------------
  // 6. Multiple undo/redo cycles
  // -----------------------------------------------------------------------

  it("single client: undo → redo → undo cycle", async () => {
    ctx = await createTwoUserDocs("undo-redo-cycle", [makeBlock("start")]);

    const { storeA } = ctx;
    const doc = storeA.getDocument();
    const blockId = doc.blocks[0].id;

    // Edit 1
    storeA.beginBatch();
    storeA.updateBlock(blockId, {
      ...doc.blocks[0],
      inlines: [{ text: "step1", style: {} }],
    });
    storeA.endBatch();

    // Edit 2
    const doc2 = storeA.getDocument();
    storeA.beginBatch();
    storeA.updateBlock(doc2.blocks[0].id, {
      ...doc2.blocks[0],
      inlines: [{ text: "step2", style: {} }],
    });
    storeA.endBatch();

    assert.equal(getBlockText(storeA, 0), "step2");

    // Undo → step1
    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "step1");

    // Redo → step2
    storeA.redo();
    assert.equal(getBlockText(storeA, 0), "step2");

    // Undo → step1
    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "step1");

    // Undo → start
    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "start");

    // Redo → step1
    storeA.redo();
    assert.equal(getBlockText(storeA, 0), "step1");
  });

  // -----------------------------------------------------------------------
  // 7. Realistic typing pattern: multiple updateBlock in single batch
  //    (simulates UI typing debounce where each keystroke replaces the
  //     entire block within one open batch)
  // -----------------------------------------------------------------------

  it("single client: batched sequential block replacements (typing pattern) + undo", async () => {
    ctx = await createTwoUserDocs("batched-typing", [makeBlock("")]);

    const { storeA } = ctx;
    const doc = storeA.getDocument();
    const blockId = doc.blocks[0].id;

    // Simulate typing "abcd" with debounce: one batch, 4 updateBlock calls
    // This is what actually happens in the UI when the user types quickly.
    storeA.beginBatch();

    // Keystroke 'a': replace block with "a"
    const d1 = storeA.getDocument();
    storeA.updateBlock(blockId, {
      ...d1.blocks[0],
      inlines: [{ text: "a", style: {} }],
    });

    // Keystroke 'b': replace block with "ab"
    const d2 = storeA.getDocument();
    storeA.updateBlock(d2.blocks[0].id, {
      ...d2.blocks[0],
      inlines: [{ text: "ab", style: {} }],
    });

    // Keystroke 'c': replace block with "abc"
    const d3 = storeA.getDocument();
    storeA.updateBlock(d3.blocks[0].id, {
      ...d3.blocks[0],
      inlines: [{ text: "abc", style: {} }],
    });

    // Keystroke 'd': replace block with "abcd"
    const d4 = storeA.getDocument();
    storeA.updateBlock(d4.blocks[0].id, {
      ...d4.blocks[0],
      inlines: [{ text: "abcd", style: {} }],
    });

    storeA.endBatch();

    assert.equal(getBlockText(storeA, 0), "abcd");

    // Single undo should revert the entire typing batch
    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "");
  });

  it("single client: two batched typing sessions + undo each", async () => {
    ctx = await createTwoUserDocs("two-batched-typing", [makeBlock("")]);

    const { storeA } = ctx;
    const doc = storeA.getDocument();
    const blockId = doc.blocks[0].id;

    // Session 1: type "ab" (2 updateBlock in one batch)
    storeA.beginBatch();
    const s1d1 = storeA.getDocument();
    storeA.updateBlock(blockId, {
      ...s1d1.blocks[0],
      inlines: [{ text: "a", style: {} }],
    });
    const s1d2 = storeA.getDocument();
    storeA.updateBlock(s1d2.blocks[0].id, {
      ...s1d2.blocks[0],
      inlines: [{ text: "ab", style: {} }],
    });
    storeA.endBatch();

    assert.equal(getBlockText(storeA, 0), "ab");

    // Session 2: type "cd" → "abcd" (2 more updateBlock in another batch)
    storeA.beginBatch();
    const s2d1 = storeA.getDocument();
    storeA.updateBlock(s2d1.blocks[0].id, {
      ...s2d1.blocks[0],
      inlines: [{ text: "abc", style: {} }],
    });
    const s2d2 = storeA.getDocument();
    storeA.updateBlock(s2d2.blocks[0].id, {
      ...s2d2.blocks[0],
      inlines: [{ text: "abcd", style: {} }],
    });
    storeA.endBatch();

    assert.equal(getBlockText(storeA, 0), "abcd");

    // First undo: revert session 2 → "ab"
    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "ab");

    // Second undo: revert session 1 → ""
    storeA.undo();
    assert.equal(getBlockText(storeA, 0), "");
  });

  it("two clients: A types in batch, B types in batch, both undo", async () => {
    ctx = await createTwoUserDocs("two-client-batched-typing", [
      makeBlock(""),
      makeBlock(""),
    ]);

    const { storeA, storeB, sync } = ctx;
    await sync();

    const docA = storeA.getDocument();
    const docB = storeB.getDocument();

    // A types "abcd" in block 0 (batched sequential replacements)
    storeA.beginBatch();
    for (const text of ["a", "ab", "abc", "abcd"]) {
      const d = storeA.getDocument();
      storeA.updateBlock(docA.blocks[0].id, {
        ...d.blocks[0],
        inlines: [{ text, style: {} }],
      });
    }
    storeA.endBatch();

    // B types "qwer" in block 1 (batched sequential replacements)
    storeB.beginBatch();
    for (const text of ["q", "qw", "qwe", "qwer"]) {
      const d = storeB.getDocument();
      storeB.updateBlock(docB.blocks[1].id, {
        ...d.blocks[1],
        inlines: [{ text, style: {} }],
      });
    }
    storeB.endBatch();

    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["abcd", "qwer"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["abcd", "qwer"]);

    // A undoes
    storeA.undo();
    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["", "qwer"]);
    assert.deepEqual(getAllBlockTexts(storeB), ["", "qwer"]);

    // B undoes
    storeB.undo();
    await sync();
    assert.deepEqual(getAllBlockTexts(storeA), ["", ""]);
    assert.deepEqual(getAllBlockTexts(storeB), ["", ""]);
  });
});
