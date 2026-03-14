import yorkie from "@yorkie-js/sdk";
import { parseRef } from "@wafflebase/sheet";
import { YorkieStore } from "@/app/spreadsheet/yorkie-store";
import type {
  ConcurrencyCase,
  ConcurrencyOp,
  ConcurrencySnapshot,
} from "../../../sheet/test/helpers/concurrency-case-table.ts";
import { initialSpreadsheetDocument } from "@/types/worksheet";

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
  SyncMode: {
    Manual: unknown;
  };
};

function cloneInitialDocument() {
  return JSON.parse(JSON.stringify(initialSpreadsheetDocument()));
}

function createDocument(key: string) {
  return new Document(key);
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

function createStore(doc: object): YorkieStore {
  return new YorkieStore(doc as never, "tab-1");
}

// 4 rounds ensures convergence: each client must push its local changes,
// pull the other client's changes, then push any conflict-resolution
// mutations, and finally pull those resolutions.
async function syncClients(
  clients: Array<{
    client: YorkieClient;
    doc: InstanceType<typeof Document>;
  }>,
): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const { client, doc } of clients) {
      await client.sync(doc);
    }
  }
}

async function applyStoreOp(store: YorkieStore, op: ConcurrencyOp): Promise<void> {
  switch (op.kind) {
    case "set-data": {
      const ref = parseRef(op.ref);
      const cell = op.value.startsWith("=")
        ? { f: op.value }
        : { v: op.value };
      await store.set(ref, cell);
      return;
    }
    case "insert-rows":
      await store.shiftCells("row", op.index, op.count ?? 1);
      return;
    case "delete-rows":
      await store.shiftCells("row", op.index, -(op.count ?? 1));
      return;
    case "insert-columns":
      await store.shiftCells("column", op.index, op.count ?? 1);
      return;
    case "delete-columns":
      await store.shiftCells("column", op.index, -(op.count ?? 1));
      return;
    case "set-row-height":
      await store.setDimensionSize("row", op.index, op.height);
      return;
    case "set-column-width":
      await store.setDimensionSize("column", op.index, op.width);
      return;
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown op kind: ${(_exhaustive as ConcurrencyOp).kind}`);
    }
  }
}

async function captureStoreSnapshot(
  store: YorkieStore,
  observe: ConcurrencyCase["observe"],
): Promise<ConcurrencySnapshot> {
  const cells: ConcurrencySnapshot["cells"] = {};
  for (const sref of observe.refs) {
    const cell = await store.get(parseRef(sref));
    cells[sref] = {
      input: cell?.f || cell?.v || "",
      display: cell?.v || cell?.f || "",
    };
  }

  const snapshot: ConcurrencySnapshot = { cells };

  if (observe.dimensions?.length) {
    const dims: NonNullable<ConcurrencySnapshot["dimensions"]> = {};
    for (const axis of observe.dimensions) {
      const sizes = await store.getDimensionSizes(axis === "row" ? "row" : "column");
      const record: Record<string, number> = {};
      for (const [k, v] of sizes) {
        record[String(k)] = v;
      }
      if (axis === "row") {
        dims.rowHeights = record;
      } else {
        dims.colWidths = record;
      }
    }
    snapshot.dimensions = dims;
  }

  return snapshot;
}

function snapshotMatchesOneOf(
  actual: ConcurrencySnapshot,
  candidates: ConcurrencySnapshot[],
): boolean {
  return candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(actual));
}

export async function runConcurrentYorkieCase(testCase: ConcurrencyCase): Promise<{
  collaboratorA: ConcurrencySnapshot;
  collaboratorB: ConcurrencySnapshot;
  converged: boolean;
  matchesSerialOrder: boolean;
}> {
  const slug = testCase.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const docKey = `concurrency-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clientA = createClient(`concurrency-a-${slug}`);
  const clientB = createClient(`concurrency-b-${slug}`);
  const docA = createDocument(docKey);
  const docB = createDocument(docKey);

  await clientA.activate();
  await clientB.activate();

  try {
    await clientA.attach(docA, {
      initialRoot: cloneInitialDocument(),
      syncMode: SyncMode.Manual,
    });
    await clientB.attach(docB, { syncMode: SyncMode.Manual });

    const storeA = createStore(docA);
    const storeB = createStore(docB);

    for (const seedOp of testCase.seed || []) {
      await applyStoreOp(storeA, seedOp);
    }
    await syncClients([
      { client: clientA, doc: docA },
      { client: clientB, doc: docB },
    ]);

    await Promise.all([
      applyStoreOp(storeA, testCase.userA),
      applyStoreOp(storeB, testCase.userB),
    ]);
    await syncClients([
      { client: clientA, doc: docA },
      { client: clientB, doc: docB },
    ]);

    const collaboratorA = await captureStoreSnapshot(storeA, testCase.observe);
    const collaboratorB = await captureStoreSnapshot(storeB, testCase.observe);
    const converged =
      JSON.stringify(collaboratorA) === JSON.stringify(collaboratorB);

    return {
      collaboratorA,
      collaboratorB,
      converged,
      matchesSerialOrder: snapshotMatchesOneOf(collaboratorA, [
        testCase.expect.aThenB,
        testCase.expect.bThenA,
      ]),
    };
  } finally {
    await Promise.allSettled([
      clientA.detach(docA),
      clientB.detach(docB),
    ]);
    await Promise.allSettled([
      clientA.deactivate(),
      clientB.deactivate(),
    ]);
  }
}
