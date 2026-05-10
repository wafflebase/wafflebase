# Native CRDT Inline Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LWW block-replacement inline styling with native CRDT operations (`splitLevel=1` + `styleByPath`) so concurrent text edits survive styling operations.

**Architecture:** Inside `YorkieDocStore.applyStyle()`, instead of rebuilding the entire block node and replacing it with `editByPath`, we split inline nodes at style boundaries using `editByPath(..., undefined, 1)` (splitLevel=1), then apply attributes with `styleByPath`. The cache update still uses the existing `applyInlineStyleHelper` pure function — only the Yorkie Tree mutation changes.

**Tech Stack:** Yorkie JS SDK 0.7.6 (`editByPath` splitLevel, `styleByPath`, `removeStyleByPath`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Modify `:804-831` | Replace `applyStyle` Yorkie mutation from block replacement to split+style |
| `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts` | Modify | Add `applyStyle` unit tests for native CRDT path |
| `packages/frontend/tests/app/docs/native-inline-style-spike.test.ts` | Delete | Spike tests superseded by real tests |
| `packages/frontend/tests/app/docs/native-inline-style-concurrent.integration.ts` | Keep | Already validates concurrent behavior |
| `docs/design/docs/docs-intent-preserving-edits.md` | Modify | Update Phase 2 status and Known Issues |

---

### Task 1: Add YorkieDocStore.applyStyle unit tests

**Files:**
- Modify: `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`

- [ ] **Step 1: Add applyStyle test cases to the existing test file**

Add a `describe('applyStyle')` block after the existing test suites. These tests exercise `applyStyle` through the `YorkieDocStore` public API (which currently uses block replacement — they should pass before and after the implementation change).

```typescript
describe('applyStyle', () => {
  it('should apply bold to a middle range', () => {
    const block = makeBlock('HelloWorld');
    store.setDocument({ blocks: [block] });
    store.applyStyle(block.id, 3, 8, { bold: true });
    const result = store.getDocument();
    const inlines = result.blocks[0].inlines;
    assert.equal(inlines.length, 3);
    assert.equal(inlines[0].text, 'Hel');
    assert.equal(inlines[0].style.bold, undefined);
    assert.equal(inlines[1].text, 'loWor');
    assert.equal(inlines[1].style.bold, true);
    assert.equal(inlines[2].text, 'ld');
    assert.equal(inlines[2].style.bold, undefined);
  });

  it('should apply bold to block start', () => {
    const block = makeBlock('Hello');
    store.setDocument({ blocks: [block] });
    store.applyStyle(block.id, 0, 3, { bold: true });
    const result = store.getDocument();
    const inlines = result.blocks[0].inlines;
    assert.equal(inlines.length, 2);
    assert.equal(inlines[0].text, 'Hel');
    assert.equal(inlines[0].style.bold, true);
    assert.equal(inlines[1].text, 'lo');
    assert.equal(inlines[1].style.bold, undefined);
  });

  it('should apply bold to block end', () => {
    const block = makeBlock('Hello');
    store.setDocument({ blocks: [block] });
    store.applyStyle(block.id, 3, 5, { bold: true });
    const result = store.getDocument();
    const inlines = result.blocks[0].inlines;
    assert.equal(inlines.length, 2);
    assert.equal(inlines[0].text, 'Hel');
    assert.equal(inlines[0].style.bold, undefined);
    assert.equal(inlines[1].text, 'lo');
    assert.equal(inlines[1].style.bold, true);
  });

  it('should apply bold to entire block', () => {
    const block = makeBlock('Hello');
    store.setDocument({ blocks: [block] });
    store.applyStyle(block.id, 0, 5, { bold: true });
    const result = store.getDocument();
    const inlines = result.blocks[0].inlines;
    assert.equal(inlines.length, 1);
    assert.equal(inlines[0].text, 'Hello');
    assert.equal(inlines[0].style.bold, true);
  });

  it('should apply style across existing multi-inline block', () => {
    const block: Block = {
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [
        { text: 'Hello', style: { bold: true } },
        { text: 'World', style: {} },
      ],
      style: { ...DEFAULT_BLOCK_STYLE },
    };
    store.setDocument({ blocks: [block] });
    store.applyStyle(block.id, 3, 8, { italic: true });
    const result = store.getDocument();
    const inlines = result.blocks[0].inlines;
    // "Hel"(bold) "lo"(bold+italic) "Wor"(italic) "ld"(plain)
    assert.equal(inlines.length, 4);
    assert.equal(inlines[0].text, 'Hel');
    assert.equal(inlines[0].style.bold, true);
    assert.equal(inlines[0].style.italic, undefined);
    assert.equal(inlines[1].text, 'lo');
    assert.equal(inlines[1].style.bold, true);
    assert.equal(inlines[1].style.italic, true);
    assert.equal(inlines[2].text, 'Wor');
    assert.equal(inlines[2].style.italic, true);
    assert.equal(inlines[3].text, 'ld');
    assert.equal(inlines[3].style.italic, undefined);
  });

  it('should work correctly after text insert', () => {
    const block = makeBlock('Hello');
    store.setDocument({ blocks: [block] });
    store.insertText(block.id, 5, ' World');
    store.applyStyle(block.id, 6, 11, { bold: true });
    const result = store.getDocument();
    const inlines = result.blocks[0].inlines;
    assert.equal(inlines.length, 2);
    assert.equal(inlines[0].text, 'Hello ');
    assert.equal(inlines[1].text, 'World');
    assert.equal(inlines[1].style.bold, true);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass with current implementation**

Run: `node --experimental-strip-types --import ./packages/frontend/tests/register-hooks.mjs --test --test-name-pattern "applyStyle" packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`
Expected: All 6 tests PASS (block replacement still works)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/tests/app/docs/yorkie-doc-store.test.ts
git commit -m "Add applyStyle unit tests for YorkieDocStore"
```

---

### Task 2: Replace applyStyle with native CRDT operations

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts:804-831`

- [ ] **Step 1: Implement native CRDT applyStyle**

Replace the `applyStyle` method body. The new implementation:
1. Resolves the block and computes which inlines need splitting
2. Inside `doc.update()`:
   a. Splits inline nodes at `fromOffset` and `toOffset` using `editByPath(..., undefined, 1)`
   b. Applies style attributes to all inlines in the range via `styleByPath`
   c. Cleans up empty inlines produced by boundary splits
3. Updates the cache using the existing `applyInlineStyleHelper` pure function

```typescript
  applyStyle(
    blockId: string,
    fromOffset: number,
    toOffset: number,
    style: Partial<InlineStyle>,
  ): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const block = this.getBlockByRegion(currentDoc, blockPath, region);

    // Compute the updated block for cache (pure function — same as before)
    const updated = applyInlineStyleHelper(block, fromOffset, toOffset, style);

    // Native CRDT: split inlines at boundaries, then style the range
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      const treeRoot = tree.getRootTreeNode();
      const blockNode = this.getTreeBlockNode(treeRoot, blockPath);

      // Resolve from/to offsets in the Yorkie tree
      const fromPos = this.resolveBlockNodeOffset(blockNode, fromOffset);
      const toPos = this.resolveBlockNodeOffset(blockNode, toOffset);

      // --- Split at toOffset first (so fromOffset paths stay valid) ---
      const toInline = (blockNode as ElementNode).children?.filter(
        (c) => c.type === 'inline',
      )[toPos.inlineIndex] as ElementNode | undefined;
      const toTextLen = (toInline?.children ?? [])
        .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
        .reduce((s, t) => s + t.value.length, 0);
      if (toPos.charOffset > 0 && toPos.charOffset < toTextLen) {
        tree.editByPath(
          [...blockPath, toPos.inlineIndex, toPos.charOffset],
          [...blockPath, toPos.inlineIndex, toPos.charOffset],
          undefined,
          1,
        );
      }

      // --- Split at fromOffset ---
      if (fromPos.charOffset > 0) {
        tree.editByPath(
          [...blockPath, fromPos.inlineIndex, fromPos.charOffset],
          [...blockPath, fromPos.inlineIndex, fromPos.charOffset],
          undefined,
          1,
        );
      }

      // --- Determine inline index range to style ---
      // After splits, re-read the block to get updated inline indices.
      const updatedBlockNode = this.getTreeBlockNode(
        tree.getRootTreeNode(),
        blockPath,
      ) as ElementNode;
      const inlines = (updatedBlockNode.children ?? []).filter(
        (c) => c.type === 'inline',
      ) as ElementNode[];

      // Walk inlines to find the range matching [fromOffset, toOffset)
      let pos = 0;
      let startIdx = -1;
      let endIdx = -1;
      for (let i = 0; i < inlines.length; i++) {
        const len = (inlines[i].children ?? [])
          .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
          .reduce((s, t) => s + t.value.length, 0);
        if (startIdx === -1 && pos + len > fromOffset) {
          startIdx = i;
        }
        if (pos + len <= toOffset && pos >= fromOffset) {
          endIdx = i;
        } else if (startIdx !== -1 && pos < toOffset) {
          endIdx = i;
        }
        pos += len;
      }

      // Fallback: if range covers from start
      if (startIdx === -1) startIdx = 0;
      if (endIdx === -1) endIdx = startIdx;

      // Walk inlines: find first that starts at fromOffset, last that ends at toOffset
      pos = 0;
      startIdx = -1;
      endIdx = -1;
      for (let i = 0; i < inlines.length; i++) {
        const len = (inlines[i].children ?? [])
          .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
          .reduce((s, t) => s + t.value.length, 0);
        if (pos >= fromOffset && pos + len <= toOffset) {
          if (startIdx === -1) startIdx = i;
          endIdx = i;
        }
        pos += len;
      }
      if (startIdx === -1) startIdx = 0;
      if (endIdx === -1) endIdx = startIdx;

      // Apply style to each inline in the range
      const styleAttrs = serializeInlineStyle(style as InlineStyle);
      for (let i = startIdx; i <= endIdx; i++) {
        // Merge new style attrs with existing attrs
        const existingAttrs = (inlines[i] as ElementNode).attributes ?? {};
        tree.styleByPath([...blockPath, i], { ...existingAttrs, ...styleAttrs });
      }

      // Clean up empty inlines created by boundary splits
      const finalBlockNode = this.getTreeBlockNode(
        tree.getRootTreeNode(),
        blockPath,
      ) as ElementNode;
      const finalInlines = (finalBlockNode.children ?? []).filter(
        (c) => c.type === 'inline',
      ) as ElementNode[];
      for (let i = finalInlines.length - 1; i >= 0; i--) {
        if (finalInlines.length <= 1) break;
        const len = (finalInlines[i].children ?? [])
          .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
          .reduce((s, t) => s + t.value.length, 0);
        if (len === 0) {
          tree.editByPath([...blockPath, i], [...blockPath, i + 1]);
        }
      }
    });

    // Update cache in-place
    this.setBlockByRegion(currentDoc, blockPath, region, updated);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }
```

**Important note:** The inline-range detection logic above is the trickiest part. After the two splits, the inlines that fall exactly within `[fromOffset, toOffset)` need to be identified. Since we split at both boundaries, the matching inlines will start exactly at `fromOffset` and end exactly at `toOffset`.

- [ ] **Step 2: Run unit tests**

Run: `node --experimental-strip-types --import ./packages/frontend/tests/register-hooks.mjs --test --test-name-pattern "applyStyle" packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`
Expected: All 6 applyStyle tests PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Run concurrent integration tests**

Run: `YORKIE_RPC_ADDR=http://localhost:8080 node --experimental-strip-types --test packages/frontend/tests/app/docs/native-inline-style-concurrent.integration.ts`
Expected: All 6 concurrent tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Replace LWW block replacement with native CRDT inline styling

Use splitLevel=1 to split inline nodes at style boundaries and
styleByPath to apply attributes. This preserves concurrent text
edits that were previously lost to last-writer-wins block replacement."
```

---

### Task 3: Delete spike test and update design doc

**Files:**
- Delete: `packages/frontend/tests/app/docs/native-inline-style-spike.test.ts`
- Modify: `docs/design/docs/docs-intent-preserving-edits.md`

- [ ] **Step 1: Delete spike test file**

```bash
rm packages/frontend/tests/app/docs/native-inline-style-spike.test.ts
```

- [ ] **Step 2: Update design doc — Phase 2 description and Known Issues**

In `docs/design/docs/docs-intent-preserving-edits.md`:

Update the Yorkie Tree Strategy table row for Style:

```markdown
| Style | `editByPath` (splitLevel=1) + `styleByPath` | Inline-level split + element style | CRDT merge |
```

Remove the `styleByPath` limitation note:

```markdown
**Inline styling (SDK 0.7.6):** Style operations use native CRDT
split+style instead of block replacement. `editByPath` with
`splitLevel=1` splits inline nodes at style boundaries, then
`styleByPath` applies attributes to the resulting inlines. This
eliminates LWW conflicts for concurrent text edits during styling.
```

Update Phase 2 description in the Phases table:

```markdown
| 2 | Inline styling (native CRDT, SDK 0.7.6) | ✅ Shipped |
```

Remove Known Issue #2 (Style operations are LWW) since it's resolved.

- [ ] **Step 3: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "Update design doc for native CRDT inline styling

Phase 2 now uses splitLevel=1 + styleByPath instead of LWW block
replacement. Remove the styleByPath limitation note since SDK 0.7.6
supports the split+style pattern for inline styling."
```
