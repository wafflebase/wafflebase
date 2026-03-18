import yorkie from "@yorkie-js/sdk";
import { YorkieStore } from "@/app/spreadsheet/yorkie-store";
import { initialSpreadsheetDocument } from "@/types/worksheet";

type YorkieClient = {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  attach(doc: object, options?: object): Promise<object>;
  detach(doc: object): Promise<object>;
};

const { Client, Document, SyncMode } = yorkie as {
  Client: new (options?: Record<string, unknown>) => YorkieClient;
  Document: new (key: string) => object;
  SyncMode: { Manual: unknown };
};

function cloneInitialDocument() {
  return JSON.parse(JSON.stringify(initialSpreadsheetDocument()));
}

export interface SingleUserContext {
  store: YorkieStore;
  cleanup(): Promise<void>;
}

/**
 * Creates a single-user Yorkie-backed store for integration testing.
 * Requires a running Yorkie server (YORKIE_RPC_ADDR).
 */
export async function createSingleUserYorkie(
  testName: string,
): Promise<SingleUserContext> {
  const slug = testName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const docKey = `single-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const client = new Client({
    key: `single-user-${slug}`,
    rpcAddr: process.env.YORKIE_RPC_ADDR ?? "http://localhost:8080",
    apiKey: process.env.YORKIE_API_KEY,
    syncLoopDuration: 10,
    retrySyncLoopDelay: 10,
    reconnectStreamDelay: 10,
  });

  const doc = new Document(docKey);

  await client.activate();
  await client.attach(doc, {
    initialRoot: cloneInitialDocument(),
    syncMode: SyncMode.Manual,
  });

  const store = new YorkieStore(doc as never, "tab-1");

  return {
    store,
    async cleanup() {
      await client.detach(doc).catch(() => {});
      await client.deactivate().catch(() => {});
    },
  };
}
