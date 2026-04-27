/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import yorkie from '@yorkie-js/sdk';
import { YorkieDocStore } from '../../../src/app/docs/yorkie-doc-store.ts';
import { generateBlockId, DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { Block } from '@wafflebase/docs';

function makeBlock(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function getTreeBlockCount(doc: any): number {
  const root = doc.getRoot();
  const tree = root.content;
  if (!tree || typeof tree.getRootTreeNode !== 'function') return -1;
  const treeRoot = tree.getRootTreeNode();
  return (treeRoot.children ?? []).filter((c: any) => c.type === 'block').length;
}

function getTreeBlockTexts(doc: any): string[] {
  const root = doc.getRoot();
  const tree = root.content;
  if (!tree || typeof tree.getRootTreeNode !== 'function') return [];
  const treeRoot = tree.getRootTreeNode();
  return (treeRoot.children ?? [])
    .filter((c: any) => c.type === 'block')
    .map((block: any) => {
      const inlines = (block.children ?? []).filter((c: any) => c.type === 'inline');
      return inlines.flatMap((inline: any) =>
        (inline.children ?? [])
          .filter((c: any) => c.type === 'text')
          .map((t: any) => t.value)
      ).join('');
    });
}

describe('mergeByPath fixes split-created block merge', () => {
  let doc: any;
  let store: YorkieDocStore;

  beforeEach(() => {
    doc = new yorkie.Document<any>('test-' + Date.now() + '-' + Math.random());
    doc.update((root: any) => {
      root.content = new yorkie.Tree({
        type: 'doc',
        children: [],
      });
    });
    store = new YorkieDocStore(doc);
  });

  it('mergeByPath on split-created blocks works', () => {
    const block = makeBlock('asdf');
    store.setDocument({ blocks: [block] });

    store.splitBlock(block.id, 2, generateBlockId(), 'paragraph');
    assert.equal(getTreeBlockCount(doc), 2);
    assert.deepEqual(getTreeBlockTexts(doc), ['as', 'df']);

    // Use mergeByPath instead of editByPath
    doc.update((root: any) => {
      const tree = root.content;
      // mergeByPath takes the path of the second block to merge into the first
      tree.mergeByPath([1]);
    });

    const treeCount = getTreeBlockCount(doc);
    const treeTexts = getTreeBlockTexts(doc);
    console.log('After mergeByPath:', treeCount, 'blocks, texts:', treeTexts);
    assert.equal(treeCount, 1, 'tree should have 1 block after mergeByPath');
  });

  it('editByPath on non-split blocks works (for comparison)', () => {
    const b1 = makeBlock('as');
    const b2 = makeBlock('df');
    store.setDocument({ blocks: [b1, b2] });

    doc.update((root: any) => {
      const tree = root.content;
      tree.editByPath([0, 1], [1, 0]);
    });

    const treeCount = getTreeBlockCount(doc);
    console.log('editByPath on non-split:', treeCount, 'blocks, texts:', getTreeBlockTexts(doc));
    assert.equal(treeCount, 1, 'editByPath works on non-split blocks');
  });

  it('editByPath on split blocks works after manual split', () => {
    // With manual two-step split (no splitLevel=2), editByPath
    // cross-boundary merge now works correctly.
    const block = makeBlock('asdf');
    store.setDocument({ blocks: [block] });

    store.splitBlock(block.id, 2, generateBlockId(), 'paragraph');

    doc.update((root: any) => {
      const tree = root.content;
      tree.editByPath([0, 1], [1, 0]);
    });

    const treeCount = getTreeBlockCount(doc);
    console.log('editByPath on split:', treeCount, 'blocks, texts:', getTreeBlockTexts(doc));
    assert.equal(treeCount, 1, 'editByPath merges manual-split blocks');
  });

  it('mergeByPath after split, insert, then merge full scenario', () => {
    const block = makeBlock('');
    store.setDocument({ blocks: [block] });

    // Type "as"
    store.insertText(block.id, 0, 'a');
    store.insertText(block.id, 1, 's');

    // Enter
    const newBlockId = generateBlockId();
    store.splitBlock(block.id, 2, newBlockId, 'paragraph');

    // Type "df"
    store.insertText(newBlockId, 0, 'd');
    store.insertText(newBlockId, 1, 'f');

    assert.equal(getTreeBlockCount(doc), 2);

    // Backspace: use mergeByPath
    doc.update((root: any) => {
      root.content.mergeByPath([1]);
    });

    const treeCount = getTreeBlockCount(doc);
    const treeTexts = getTreeBlockTexts(doc);
    console.log('Full scenario with mergeByPath:', treeCount, 'blocks, texts:', treeTexts);
    assert.equal(treeCount, 1, 'tree should have 1 block');
  });
});
