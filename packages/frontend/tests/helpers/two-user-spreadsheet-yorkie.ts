import yorkie from '@yorkie-js/sdk';
import { YorkieStore } from '@/app/spreadsheet/yorkie-store.ts';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';

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
    apiKey: process.env.YORKIE_PUBLIC_KEY,
    syncLoopDuration: 10,
    retrySyncLoopDelay: 10,
    reconnectStreamDelay: 10,
  });
}

/**
 * 4 rounds ensures convergence: each client pushes local changes,
 * pulls the other's changes, pushes conflict-resolution mutations,
 * and finally pulls those resolutions. Same shape as docs/slides helpers.
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

export interface TwoUserSpreadsheetContext {
  storeA: YorkieStore;
  storeB: YorkieStore;
  /** tabId shared by both stores */
  tabId: string;
  sync(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Spin up two real Yorkie clients sharing a single spreadsheet document,
 * attach an initialised spreadsheet root on client A, sync to B, then
 * return YorkieStore adapters for both clients.
 *
 * Requires a running Yorkie server (YORKIE_RPC_ADDR).
 *
 * Usage:
 *   const ctx = await createTwoUserSpreadsheet('my-test');
 *   // perform concurrent ops on ctx.storeA / ctx.storeB
 *   await ctx.sync();
 *   // assert convergence
 *   await ctx.cleanup();
 */
export async function createTwoUserSpreadsheet(
  testName: string,
): Promise<TwoUserSpreadsheetContext> {
  const slug = testName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const docKey = `sheets-comments-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tabId = 'tab-1';

  const clientA = createClient(`sheets-a-${slug}`);
  const clientB = createClient(`sheets-b-${slug}`);
  const docA = new Document(docKey);
  const docB = new Document(docKey);

  await clientA.activate();
  await clientB.activate();

  const cleanup = async () => {
    await Promise.allSettled([clientA.detach(docA), clientB.detach(docB)]);
    await Promise.allSettled([clientA.deactivate(), clientB.deactivate()]);
  };

  try {
    // Client A creates the document with the initial spreadsheet root.
    await clientA.attach(docA, {
      initialRoot: JSON.parse(JSON.stringify(initialSpreadsheetDocument())),
      syncMode: SyncMode.Manual,
    });

    // Push to server so B can pull the initial structure.
    await clientA.sync(docA);
    await clientB.attach(docB, { syncMode: SyncMode.Manual });
    await syncClients([
      { client: clientA, doc: docA },
      { client: clientB, doc: docB },
    ]);

    const storeA = new YorkieStore(docA as never, tabId);
    const storeB = new YorkieStore(docB as never, tabId);

    // Initialise row/col axis IDs so addThread anchors are stable.
    storeA.ensureAxisOrder(5, 5);
    await syncClients([
      { client: clientA, doc: docA },
      { client: clientB, doc: docB },
    ]);

    return {
      storeA,
      storeB,
      tabId,
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
