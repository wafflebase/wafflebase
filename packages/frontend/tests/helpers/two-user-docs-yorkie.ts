import yorkie from '@yorkie-js/sdk';
import { YorkieDocStore } from '@/app/docs/yorkie-doc-store.ts';
import type { YorkieDocsRoot } from '@/types/docs-document.ts';
import { generateBlockId, DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { Block } from '@wafflebase/docs';

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

function makeBlock(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

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
 * 4 rounds ensures convergence: each client pushes local changes, pulls
 * the other's changes, pushes conflict-resolution mutations, and finally
 * pulls those resolutions.
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

export interface TwoUserDocsContext {
  storeA: YorkieDocStore;
  storeB: YorkieDocStore;
  sync(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Creates two Yorkie-backed docs stores connected to the same document
 * for concurrent editing integration tests.
 *
 * Requires a running Yorkie server (YORKIE_RPC_ADDR).
 */
export async function createTwoUserDocs(
  testName: string,
  initialBlocks: Block[],
): Promise<TwoUserDocsContext> {
  const slug = testName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const docKey = `docs-concurrent-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const clientA = createClient(`docs-a-${slug}`);
  const clientB = createClient(`docs-b-${slug}`);
  const docA = new Document<YorkieDocsRoot>(docKey);
  const docB = new Document<YorkieDocsRoot>(docKey);

  await clientA.activate();
  await clientB.activate();

  // Client A creates the initial document with a Tree
  await clientA.attach(docA, {
    syncMode: SyncMode.Manual,
  });

  const storeA = new YorkieDocStore(docA as never);
  storeA.setDocument({ blocks: initialBlocks });

  // Sync so client B gets the initial state
  await clientA.sync(docA);
  await clientB.attach(docB, { syncMode: SyncMode.Manual });
  await syncClients([
    { client: clientA, doc: docA },
    { client: clientB, doc: docB },
  ]);

  const storeB = new YorkieDocStore(docB as never);

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
      await Promise.allSettled([
        clientA.detach(docA),
        clientB.detach(docB),
      ]);
      await Promise.allSettled([
        clientA.deactivate(),
        clientB.deactivate(),
      ]);
    },
  };
}

export { makeBlock };
