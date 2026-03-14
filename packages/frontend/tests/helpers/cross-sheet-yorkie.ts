import yorkie from "@yorkie-js/sdk";
import type { Grid, Cell, Sref, GridResolver } from "@wafflebase/sheet";
import { parseRef, getWorksheetCell } from "@wafflebase/sheet";
import { Sheet } from "../../../sheet/src/model/worksheet/sheet.ts";
import { MemStore } from "../../../sheet/src/store/memory.ts";
import { YorkieStore } from "@/app/spreadsheet/yorkie-store";
import type { SpreadsheetDocument, Worksheet } from "@/types/worksheet";
import { createWorksheet } from "@/types/worksheet";

// --- Yorkie SDK wrappers (same pattern as two-user-yorkie.ts) ---

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
    rpcAddr: process.env.YORKIE_RPC_ADDR ?? "http://localhost:8080",
    apiKey: process.env.YORKIE_API_KEY,
    syncLoopDuration: 10,
    retrySyncLoopDelay: 10,
    reconnectStreamDelay: 10,
  });
}

function initialTwoTabDocument(): SpreadsheetDocument {
  return {
    tabs: {
      "tab-1": { id: "tab-1", name: "Sheet1", type: "sheet" },
      "tab-2": { id: "tab-2", name: "Sheet2", type: "sheet" },
    },
    tabOrder: ["tab-1", "tab-2"],
    sheets: {
      "tab-1": createWorksheet(),
      "tab-2": createWorksheet(),
    },
  };
}

async function syncClients(
  clients: Array<{ client: YorkieClient; doc: object }>,
): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const { client, doc } of clients) {
      await client.sync(doc);
    }
  }
}

export type CrossSheetEnv = {
  /** YorkieStore for ClientB's tab-2 (Sheet2 — data producer) */
  storeB2: YorkieStore;
  /** Sheet instance backed by MemStore with GridResolver reading from Yorkie */
  sheetA: Sheet;
  /** Sync both clients (4 rounds) */
  sync: () => Promise<void>;
  /** Subscribe to ClientA's document events */
  subscribeA: (cb: (e: unknown) => void) => void;
  /** Cleanup: detach + deactivate both clients */
  cleanup: () => Promise<void>;
};

export async function setupCrossSheetEnv(
  testName: string,
): Promise<CrossSheetEnv> {
  const slug = testName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const docKey = `cross-sheet-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const clientA = createClient(`cross-sheet-a-${slug}`);
  const clientB = createClient(`cross-sheet-b-${slug}`);
  const docA = new Document(docKey);
  const docB = new Document(docKey);

  await clientA.activate();
  await clientB.activate();

  await clientA.attach(docA, {
    initialRoot: JSON.parse(JSON.stringify(initialTwoTabDocument())),
    syncMode: SyncMode.Manual,
  });
  await clientB.attach(docB, { syncMode: SyncMode.Manual });

  // Sync so both clients have the 2-tab structure
  await syncClients([
    { client: clientA, doc: docA },
    { client: clientB, doc: docB },
  ]);

  // ClientB writes to tab-2 via YorkieStore
  const storeB2 = new YorkieStore(docB as never, "tab-2");

  // ClientA uses MemStore for Sheet (avoids ANTLR bundle issue in Node.js).
  // Cross-sheet data comes from Yorkie doc via GridResolver.
  const memStore = new MemStore();
  const sheetA = new Sheet(memStore);

  // GridResolver: read tab-2 data from ClientA's synced Yorkie copy.
  // Uses getWorksheetCell() which handles rowOrder/colOrder mapping.
  const resolver: GridResolver = (
    sheetName: string,
    refs: Set<Sref>,
  ): Grid | undefined => {
    if (sheetName !== "SHEET2") return undefined;
    const grid: Grid = new Map<Sref, Cell>();
    const root = (docA as { getRoot(): SpreadsheetDocument }).getRoot();
    const ws = root.sheets["tab-2"];
    if (!ws) return undefined;
    for (const sref of refs) {
      const ref = parseRef(sref);
      const cellData = getWorksheetCell(ws as Worksheet, ref);
      if (cellData) {
        grid.set(sref, cellData as Cell);
      }
    }
    return grid.size > 0 ? grid : undefined;
  };

  sheetA.setGridResolver(resolver);

  const sync = () =>
    syncClients([
      { client: clientA, doc: docA },
      { client: clientB, doc: docB },
    ]);

  const subscribeA = (cb: (e: unknown) => void) => {
    (docA as { subscribe(cb: (e: unknown) => void): void }).subscribe(cb);
  };

  const cleanup = async () => {
    await Promise.allSettled([
      clientA.detach(docA),
      clientB.detach(docB),
    ]);
    await Promise.allSettled([
      clientA.deactivate(),
      clientB.deactivate(),
    ]);
  };

  return { storeB2, sheetA, sync, subscribeA, cleanup };
}
