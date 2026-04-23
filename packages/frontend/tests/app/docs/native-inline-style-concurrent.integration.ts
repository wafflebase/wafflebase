/**
 * Concurrent integration tests: native CRDT inline styling
 *
 * Tests whether splitLevel=1 + styleByPath approach handles concurrent
 * operations better than the current LWW block replacement.
 *
 * Requires a running Yorkie server:
 *   docker compose up -d
 *   YORKIE_RPC_ADDR=http://localhost:8080 node --experimental-strip-types \
 *     --test packages/frontend/tests/app/docs/native-inline-style-concurrent.integration.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import yorkie, { type ElementNode } from '@yorkie-js/sdk';

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function syncClients(
  clients: Array<{ client: YorkieClient; doc: any }>,
): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const { client, doc } of clients) {
      await client.sync(doc);
    }
  }
}

function getInlines(blockNode: ElementNode) {
  return (blockNode.children ?? []).filter(
    (c): c is ElementNode => c.type === 'inline',
  );
}

function inlineText(inline: ElementNode): string {
  return (inline.children ?? [])
    .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
    .reduce((s, t) => s + t.value, '');
}

function describeInlines(tree: any) {
  const root = tree.getRootTreeNode();
  const blocks = (root.children ?? []).filter(
    (c: any): c is ElementNode => c.type === 'block',
  );
  return blocks.map((block: ElementNode) =>
    getInlines(block).map((inline) => ({
      text: inlineText(inline),
      attrs: inline.attributes ?? {},
    })),
  );
}

function treeFullText(tree: any): string {
  const root = tree.getRootTreeNode();
  return (root.children ?? [])
    .filter((c: any): c is ElementNode => c.type === 'block')
    .map((block: ElementNode) =>
      getInlines(block).map(inlineText).join(''),
    )
    .join('|');
}

// ---------------------------------------------------------------------------
// Two-client setup for raw Tree tests (not YorkieDocStore)
// ---------------------------------------------------------------------------

interface TwoClientCtx {
  docA: any;
  docB: any;
  clientA: YorkieClient;
  clientB: YorkieClient;
  sync(): Promise<void>;
  cleanup(): Promise<void>;
}

async function createTwoClients(
  testName: string,
  initialTree: any,
): Promise<TwoClientCtx> {
  const slug = testName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const docKey = `inline-spike-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const clientA = createClient(`spike-a-${slug}`);
  const clientB = createClient(`spike-b-${slug}`);
  const docA = new Document<any>(docKey);
  const docB = new Document<any>(docKey);

  await clientA.activate();
  await clientB.activate();

  const cleanup = async () => {
    await Promise.allSettled([clientA.detach(docA), clientB.detach(docB)]);
    await Promise.allSettled([clientA.deactivate(), clientB.deactivate()]);
  };

  try {
    await clientA.attach(docA, { syncMode: SyncMode.Manual });
    (docA as any).update((root: any) => {
      root.content = new yorkie.Tree(initialTree);
    });
    await clientA.sync(docA);

    await clientB.attach(docB, { syncMode: SyncMode.Manual });
    await syncClients([
      { client: clientA, doc: docA },
      { client: clientB, doc: docB },
    ]);

    return {
      docA,
      docB,
      clientA,
      clientB,
      async sync() {
        await syncClients([
          { client: clientA, doc: docA },
          { client: clientB, doc: docB },
        ]);
      },
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

const SINGLE_BLOCK_TREE = {
  type: 'doc',
  children: [
    {
      type: 'block',
      attributes: { id: 'b1', type: 'paragraph' },
      children: [
        {
          type: 'inline',
          attributes: {},
          children: [{ type: 'text', value: 'HelloWorld' }],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Native inline style concurrent tests', { skip: !shouldRun }, () => {

  // =========================================================================
  // 1. Concurrent text insert + native style (the key improvement)
  // =========================================================================
  it('concurrent text insert + splitLevel=1 style should preserve both', async () => {
    const ctx = await createTwoClients('text-insert-and-style', SINGLE_BLOCK_TREE);
    try {
      // Client A: apply bold to "World" (offset 5..10) via native split+style
      (ctx.docA as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 5], [0, 0, 5], undefined, 1);
        tree.styleByPath([0, 1], { bold: 'true' });
      });

      // Client B: insert "XX" at offset 3 (inside "Hello")
      (ctx.docB as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 3], [0, 0, 3], { type: 'text', value: 'XX' });
      });

      await ctx.sync();

      const textA = treeFullText(ctx.docA.getRoot().content);
      const textB = treeFullText(ctx.docB.getRoot().content);

      // Both texts should be identical (convergence)
      assert.equal(textA, textB, `Divergence: A="${textA}" B="${textB}"`);

      // Both the insertion and the full original text should be preserved
      const fullText = textA.replace('|', '');
      assert.ok(fullText.includes('XX'), `Insertion "XX" should be preserved, got "${fullText}"`);
      assert.equal(fullText.length, 12, `Expected 12 chars (10 + 2), got "${fullText}"`);

      // Check that bold is still on "World" portion
      const inlinesA = describeInlines(ctx.docA.getRoot().content);
      console.log('  text+style result:', JSON.stringify(inlinesA));

      // At minimum, "World" should still have bold=true somewhere
      const allInlines = inlinesA[0];
      const boldParts = allInlines.filter((i: any) => i.attrs.bold === 'true');
      assert.ok(boldParts.length > 0, 'Bold style should be preserved');
      const boldText = boldParts.map((i: any) => i.text).join('');
      assert.ok(boldText.includes('World'), `Bold text should contain "World", got "${boldText}"`);
    } finally {
      await ctx.cleanup();
    }
  });

  // =========================================================================
  // 2. Concurrent text insert + block replacement (current LWW approach)
  //    For comparison — shows the problem we're solving
  // =========================================================================
  it('(baseline) concurrent text insert + block replacement loses text edit', async () => {
    const ctx = await createTwoClients('text-insert-and-block-replace', SINGLE_BLOCK_TREE);
    try {
      // Client A: block replacement — simulates current applyStyle behavior
      (ctx.docA as any).update((root: any) => {
        const tree = root.content;
        // Replace entire block with styled version
        tree.editByPath([0], [1], {
          type: 'block',
          attributes: { id: 'b1', type: 'paragraph' },
          children: [
            {
              type: 'inline',
              attributes: {},
              children: [{ type: 'text', value: 'Hello' }],
            },
            {
              type: 'inline',
              attributes: { bold: 'true' },
              children: [{ type: 'text', value: 'World' }],
            },
          ],
        });
      });

      // Client B: character-level insert "XX" at offset 3
      (ctx.docB as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 3], [0, 0, 3], { type: 'text', value: 'XX' });
      });

      await ctx.sync();

      const textA = treeFullText(ctx.docA.getRoot().content);
      const textB = treeFullText(ctx.docB.getRoot().content);

      console.log('  LWW baseline: A="%s" B="%s"', textA, textB);

      // With LWW block replacement, the text insert is likely LOST
      // This demonstrates why native CRDT inline styling is needed
      if (!textA.includes('XX')) {
        console.log('  --> Confirmed: block replacement LOST the concurrent text insert');
      } else {
        console.log('  --> Surprisingly preserved (implementation may differ)');
      }
      // We don't assert failure here — just demonstrate the difference
    } finally {
      await ctx.cleanup();
    }
  });

  // =========================================================================
  // 3. Concurrent style + style on non-overlapping ranges
  // =========================================================================
  it('concurrent non-overlapping styles should both be applied', async () => {
    const ctx = await createTwoClients('style-non-overlap', SINGLE_BLOCK_TREE);
    try {
      // Client A: bold "Hello" (offset 0..5)
      (ctx.docA as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 5], [0, 0, 5], undefined, 1);
        // inline0="Hello", inline1="World"
        tree.styleByPath([0, 0], { bold: 'true' });
      });

      // Client B: italic "World" (offset 5..10)
      (ctx.docB as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 5], [0, 0, 5], undefined, 1);
        // inline0="Hello", inline1="World"
        tree.styleByPath([0, 1], { italic: 'true' });
      });

      await ctx.sync();

      const textA = treeFullText(ctx.docA.getRoot().content);
      const textB = treeFullText(ctx.docB.getRoot().content);
      assert.equal(textA, textB, `Divergence: A="${textA}" B="${textB}"`);

      const inlinesA = describeInlines(ctx.docA.getRoot().content);
      const inlinesB = describeInlines(ctx.docB.getRoot().content);
      console.log('  non-overlap A:', JSON.stringify(inlinesA));
      console.log('  non-overlap B:', JSON.stringify(inlinesB));

      // Check both styles are preserved
      const allA = inlinesA[0];
      const boldParts = allA.filter((i: any) => i.attrs.bold === 'true');
      const italicParts = allA.filter((i: any) => i.attrs.italic === 'true');

      assert.ok(boldParts.length > 0, 'Bold should be preserved');
      assert.ok(italicParts.length > 0, 'Italic should be preserved');
    } finally {
      await ctx.cleanup();
    }
  });

  // =========================================================================
  // 4. Concurrent style + style on overlapping ranges
  // =========================================================================
  it('concurrent overlapping styles — check convergence', async () => {
    const ctx = await createTwoClients('style-overlap', SINGLE_BLOCK_TREE);
    try {
      // Client A: bold offset 0..7 ("HelloWo")
      (ctx.docA as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 7], [0, 0, 7], undefined, 1);
        tree.styleByPath([0, 0], { bold: 'true' });
      });

      // Client B: italic offset 3..10 ("loWorld")
      (ctx.docB as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 3], [0, 0, 3], undefined, 1);
        tree.styleByPath([0, 1], { italic: 'true' });
      });

      await ctx.sync();

      const textA = treeFullText(ctx.docA.getRoot().content);
      const textB = treeFullText(ctx.docB.getRoot().content);
      assert.equal(textA, textB, `Text divergence: A="${textA}" B="${textB}"`);
      assert.equal(textA, 'HelloWorld', 'Full text should be preserved');

      const inlinesA = describeInlines(ctx.docA.getRoot().content);
      const inlinesB = describeInlines(ctx.docB.getRoot().content);
      console.log('  overlap A:', JSON.stringify(inlinesA));
      console.log('  overlap B:', JSON.stringify(inlinesB));

      // Check convergence — both clients should have same inline structure
      assert.deepEqual(inlinesA, inlinesB, 'Inline structure should converge');
    } finally {
      await ctx.cleanup();
    }
  });

  // =========================================================================
  // 5. Concurrent splitLevel=1 (style) + splitLevel=2 (block split)
  //    This is the risky "mixed splitLevel" scenario
  // =========================================================================
  it('concurrent inline split (style) + block split — check convergence', async () => {
    const ctx = await createTwoClients('inline-split-and-block-split', SINGLE_BLOCK_TREE);
    try {
      // Client A: inline split at offset 3 for styling (splitLevel=1)
      (ctx.docA as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 3], [0, 0, 3], undefined, 1);
        tree.styleByPath([0, 1], { bold: 'true' });
      });

      // Client B: block split at offset 5 (Enter key, splitLevel=2)
      (ctx.docB as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 5], [0, 0, 5], undefined, 2);
      });

      await ctx.sync();

      const textA = treeFullText(ctx.docA.getRoot().content);
      const textB = treeFullText(ctx.docB.getRoot().content);

      console.log('  mixed split A:', JSON.stringify(describeInlines(ctx.docA.getRoot().content)));
      console.log('  mixed split B:', JSON.stringify(describeInlines(ctx.docB.getRoot().content)));
      console.log('  text A="%s" B="%s"', textA, textB);

      // At minimum: convergence
      assert.equal(textA, textB, `Text divergence: A="${textA}" B="${textB}"`);

      // All original text should be preserved
      const combined = textA.replace(/\|/g, '');
      assert.equal(combined, 'HelloWorld', `Full text should be preserved, got "${combined}"`);
    } finally {
      await ctx.cleanup();
    }
  });

  // =========================================================================
  // 6. Concurrent text delete + native style
  // =========================================================================
  it('concurrent text delete + native style should preserve both', async () => {
    const ctx = await createTwoClients('text-delete-and-style', SINGLE_BLOCK_TREE);
    try {
      // Client A: bold "World" (offset 5..10)
      (ctx.docA as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 5], [0, 0, 5], undefined, 1);
        tree.styleByPath([0, 1], { bold: 'true' });
      });

      // Client B: delete "lo" (offset 3..5)
      (ctx.docB as any).update((root: any) => {
        const tree = root.content;
        tree.editByPath([0, 0, 3], [0, 0, 5]);
      });

      await ctx.sync();

      const textA = treeFullText(ctx.docA.getRoot().content);
      const textB = treeFullText(ctx.docB.getRoot().content);

      console.log('  delete+style A="%s" B="%s"', textA, textB);
      console.log('  inlines A:', JSON.stringify(describeInlines(ctx.docA.getRoot().content)));

      assert.equal(textA, textB, `Divergence: A="${textA}" B="${textB}"`);

      // "lo" should be deleted, "World" should still be bold
      const combined = textA.replace(/\|/g, '');
      assert.equal(combined, 'HelWorld', `Expected "HelWorld", got "${combined}"`);
    } finally {
      await ctx.cleanup();
    }
  });
});
