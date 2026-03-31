import yorkie from "@yorkie-js/sdk";
import { YorkieDocStore } from "@/app/docs/yorkie-doc-store.ts";
import type { YorkieDocsRoot } from "@/types/docs-document.ts";
import {
  generateBlockId,
  DEFAULT_BLOCK_STYLE,
} from "@wafflebase/docs";
import type { Block } from "@wafflebase/docs";

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

export function makeBlock(text: string): Block {
  return {
    id: generateBlockId(),
    type: "paragraph",
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function createClient(key: string): YorkieClient {
  return new Client({
    key,
    rpcAddr: process.env.YORKIE_RPC_ADDR ?? "http://localhost:8080",
    apiKey: process.env.YORKIE_API_KEY,
    syncLoopDuration: 10,
    retrySyncLoopDelay: 10,
    reconnectStreamDelay: 10,
  });
}

export interface TwoUserDocsContext {
  storeA: YorkieDocStore;
  storeB: YorkieDocStore;
  /** Sync both clients (4 rounds for convergence). */
  sync(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Creates a two-user Yorkie-backed docs environment for integration testing.
 * Both clients attach to the same document.
 *
 * @param testName - Unique test name for document key generation
 * @param initialBlocks - Blocks to seed the document with (via clientA)
 */
export async function createTwoUserDocs(
  testName: string,
  initialBlocks?: Block[],
): Promise<TwoUserDocsContext> {
  const slug = testName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const docKey = `docs-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const clientA = createClient(`docs-a-${slug}`);
  const clientB = createClient(`docs-b-${slug}`);
  const docA = new Document(docKey) as ReturnType<typeof yorkie.Document<YorkieDocsRoot>>;
  const docB = new Document(docKey) as ReturnType<typeof yorkie.Document<YorkieDocsRoot>>;

  await clientA.activate();
  await clientB.activate();

  // Client A creates the document with initial tree
  await clientA.attach(docA, { syncMode: SyncMode.Manual });
  const storeA = new YorkieDocStore(docA as never);

  // Seed initial content
  if (initialBlocks && initialBlocks.length > 0) {
    storeA.setDocument({ blocks: initialBlocks });
  } else {
    storeA.setDocument({ blocks: [makeBlock("")] });
  }

  // Sync so Client B sees the initial state
  await clientA.sync(docA);

  await clientB.attach(docB, { syncMode: SyncMode.Manual });
  await clientB.sync(docB);

  const storeB = new YorkieDocStore(docB as never);

  async function sync(): Promise<void> {
    for (let round = 0; round < 4; round++) {
      await clientA.sync(docA);
      await clientB.sync(docB);
    }
  }

  async function cleanup(): Promise<void> {
    await Promise.allSettled([
      clientA.detach(docA),
      clientB.detach(docB),
    ]);
    await Promise.allSettled([
      clientA.deactivate(),
      clientB.deactivate(),
    ]);
  }

  return { storeA, storeB, sync, cleanup };
}

/**
 * Get the text of a specific block by index from a store.
 */
export function getBlockText(store: YorkieDocStore, blockIndex: number): string {
  const doc = store.getDocument();
  const block = doc.blocks[blockIndex];
  if (!block) return "";
  return block.inlines.map((i) => i.text).join("");
}

/**
 * Get all block texts from a store as an array.
 */
export function getAllBlockTexts(store: YorkieDocStore): string[] {
  const doc = store.getDocument();
  return doc.blocks.map((b) => b.inlines.map((i) => i.text).join(""));
}
