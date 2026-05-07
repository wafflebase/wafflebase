import yorkie from '@yorkie-js/sdk';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '@/app/slides/yorkie-slides-store.ts';
import type { YorkieSlidesRoot } from '@/types/slides-document.ts';

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

/**
 * 4 rounds ensures convergence: each client pushes local changes,
 * pulls the other's changes, pushes any conflict-resolution
 * mutations, and finally pulls those resolutions. Same shape as
 * the docs and sheets two-user helpers.
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

export interface TwoUserSlidesContext {
  storeA: YorkieSlidesStore;
  storeB: YorkieSlidesStore;
  sync(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Spin up two real Yorkie clients sharing a single document key,
 * attach an initialised slides root on each, and return adapters.
 *
 * Usage:
 *   const ctx = await createTwoUserSlides('my-test-slug');
 *   ctx.storeA.batch(() => ctx.storeA.addSlide('blank'));
 *   ctx.storeB.batch(() => ctx.storeB.addSlide('blank'));
 *   await ctx.sync();
 *   // Both stores now see two slides.
 *   await ctx.cleanup();
 */
export async function createTwoUserSlides(
  testName: string,
): Promise<TwoUserSlidesContext> {
  const slug = testName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const docKey = `slides-concurrent-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const clientA = createClient(`slides-a-${slug}`);
  const clientB = createClient(`slides-b-${slug}`);
  await clientA.activate();
  await clientB.activate();

  const docA = new Document(docKey) as yorkie.Document<YorkieSlidesRoot>;
  const docB = new Document(docKey) as yorkie.Document<YorkieSlidesRoot>;

  await clientA.attach(docA, { syncMode: SyncMode.Manual });
  await clientB.attach(docB, { syncMode: SyncMode.Manual });

  // Initialise root on A and propagate to B before either store starts.
  ensureSlidesRoot(docA);
  await syncClients([
    { client: clientA, doc: docA },
    { client: clientB, doc: docB },
  ]);

  const storeA = new YorkieSlidesStore(docA);
  const storeB = new YorkieSlidesStore(docB);

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
      try {
        await clientA.detach(docA);
        await clientB.detach(docB);
      } finally {
        await clientA.deactivate();
        await clientB.deactivate();
      }
    },
  };
}
