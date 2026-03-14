# Cross-Sheet Yorkie Integration Tests

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Yorkie multi-client integration tests that verify cross-sheet formula recalculation works correctly when remote users edit data in other sheets.

**Architecture:** Create a dedicated test helper that sets up a 2-tab Yorkie document shared between two clients, with Sheet + GridResolver wired to read cross-tab data. Tests verify formula convergence after sync and event path filtering.

**Tech Stack:** Node test runner, Yorkie SDK, YorkieStore, Sheet, GridResolver

---

## Chunk 1: Helper + Tests

### Task 1: Create cross-sheet Yorkie helper

**Files:**
- Create: `packages/frontend/tests/helpers/cross-sheet-yorkie.ts`

- [x] **Step 1: Write the helper module**

The helper creates a 2-tab Yorkie document shared between two clients. ClientA owns tab-1 (Sheet1 with cross-sheet formulas), ClientB owns tab-2 (Sheet2 with source data). A GridResolver on ClientA's Sheet reads from ClientA's tab-2 YorkieStore so that after sync, cross-sheet refs resolve correctly.

```typescript
import yorkie from "@yorkie-js/sdk";
import { parseRef, Sheet } from "@wafflebase/sheet";
import type { Grid, Cell, Sref, GridResolver } from "@wafflebase/sheet";
import { YorkieStore } from "@/app/spreadsheet/yorkie-store";
import type { SpreadsheetDocument } from "@/types/worksheet";
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
  /** YorkieStore for ClientA's tab-1 (Sheet1 — formula consumer) */
  storeA1: YorkieStore;
  /** YorkieStore for ClientB's tab-2 (Sheet2 — data producer) */
  storeB2: YorkieStore;
  /** Sheet instance backed by storeA1 with GridResolver wired */
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

  const storeA1 = new YorkieStore(docA as never, "tab-1");
  const storeA2 = new YorkieStore(docA as never, "tab-2");
  const storeB2 = new YorkieStore(docB as never, "tab-2");

  const sheetA = new Sheet(storeA1);

  // GridResolver: read tab-2 data from ClientA's synced copy
  const resolver: GridResolver = (
    sheetName: string,
    refs: Set<Sref>,
  ): Grid | undefined => {
    if (sheetName !== "SHEET2") return undefined;
    const grid: Grid = new Map<Sref, Cell>();
    // Read directly from storeA2 (synced from clientB)
    for (const sref of refs) {
      const ref = parseRef(sref);
      // Use synchronous access — storeA2.get() returns Promise but
      // the underlying Yorkie doc access is synchronous.
      // We build the grid from the doc root directly.
      const root = (docA as { getRoot(): SpreadsheetDocument }).getRoot();
      const ws = root.sheets["tab-2"];
      if (ws?.cells?.[sref]) {
        const cellData = ws.cells[sref];
        grid.set(sref, {
          v: typeof cellData.v === "string" ? cellData.v : cellData.v !== undefined ? String(cellData.v) : undefined,
          f: typeof cellData.f === "string" ? cellData.f : undefined,
        } as Cell);
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

  return { storeA1, storeB2, sheetA, sync, subscribeA, cleanup };
}
```

- [x] **Step 2: Commit helper**

```bash
git add packages/frontend/tests/helpers/cross-sheet-yorkie.ts
git commit -m "Add cross-sheet Yorkie integration test helper

Two-client, two-tab setup for testing cross-sheet formula
recalculation through Yorkie sync."
```

---

### Task 2: Write cross-sheet Yorkie integration tests

**Files:**
- Create: `packages/frontend/tests/app/spreadsheet/yorkie-cross-sheet.test.ts`

- [x] **Step 1: Write test file with all 5 test cases**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { parseRef } from "@wafflebase/sheet";
import { setupCrossSheetEnv } from "../../helpers/cross-sheet-yorkie.ts";

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

test("cross-sheet formula resolves after sync", { skip: !shouldRun }, async () => {
  const env = await setupCrossSheetEnv("formula-resolves");
  try {
    // ClientB writes value to Sheet2!A1
    await env.storeB2.set(parseRef("A1"), { v: "42" });
    await env.sync();

    // ClientA sets cross-sheet formula in Sheet1!A1
    await env.sheetA.setData({ r: 1, c: 1 }, "=Sheet2!A1");

    assert.equal(await env.sheetA.toDisplayString({ r: 1, c: 1 }), "42");
  } finally {
    await env.cleanup();
  }
});

test("cross-sheet formula updates on remote change", { skip: !shouldRun }, async () => {
  const env = await setupCrossSheetEnv("formula-updates");
  try {
    // Seed: ClientB sets Sheet2!A1 = 100
    await env.storeB2.set(parseRef("A1"), { v: "100" });
    await env.sync();

    // ClientA creates cross-sheet formula
    await env.sheetA.setData({ r: 1, c: 1 }, "=Sheet2!A1");
    assert.equal(await env.sheetA.toDisplayString({ r: 1, c: 1 }), "100");

    // ClientB updates Sheet2!A1 to 999
    await env.storeB2.set(parseRef("A1"), { v: "999" });
    await env.sync();

    // Recalculate and verify
    await env.sheetA.recalculateCrossSheetFormulas();
    assert.equal(await env.sheetA.toDisplayString({ r: 1, c: 1 }), "999");
  } finally {
    await env.cleanup();
  }
});

test("SUM with cross-sheet range", { skip: !shouldRun }, async () => {
  const env = await setupCrossSheetEnv("sum-range");
  try {
    // ClientB populates Sheet2!A1:A3
    await env.storeB2.set(parseRef("A1"), { v: "10" });
    await env.storeB2.set(parseRef("A2"), { v: "20" });
    await env.storeB2.set(parseRef("A3"), { v: "30" });
    await env.sync();

    // ClientA sums the cross-sheet range
    await env.sheetA.setData({ r: 1, c: 1 }, "=SUM(Sheet2!A1:A3)");

    assert.equal(await env.sheetA.toDisplayString({ r: 1, c: 1 }), "60");
  } finally {
    await env.cleanup();
  }
});

test("local dependent chain recalculates after cross-sheet update", { skip: !shouldRun }, async () => {
  const env = await setupCrossSheetEnv("dependent-chain");
  try {
    // Seed Sheet2!A1 = 1
    await env.storeB2.set(parseRef("A1"), { v: "1" });
    await env.sync();

    // ClientA: A1 = =Sheet2!A1, A2 = 2, B1 = =SUM(A1:A2)
    await env.sheetA.setData({ r: 1, c: 1 }, "=Sheet2!A1");
    await env.sheetA.setData({ r: 2, c: 1 }, "2");
    await env.sheetA.setData({ r: 1, c: 2 }, "=SUM(A1:A2)");

    assert.equal(await env.sheetA.toDisplayString({ r: 1, c: 1 }), "1");
    assert.equal(await env.sheetA.toDisplayString({ r: 1, c: 2 }), "3");

    // ClientB updates Sheet2!A1 to 10
    await env.storeB2.set(parseRef("A1"), { v: "10" });
    await env.sync();

    await env.sheetA.recalculateCrossSheetFormulas();

    assert.equal(await env.sheetA.toDisplayString({ r: 1, c: 1 }), "10");
    assert.equal(await env.sheetA.toDisplayString({ r: 1, c: 2 }), "12");
  } finally {
    await env.cleanup();
  }
});

test("remote-change event includes cell path for data edits", { skip: !shouldRun }, async () => {
  const env = await setupCrossSheetEnv("event-path");
  try {
    // Collect remote-change events on ClientA
    const events: Array<{ type: string; operations?: Array<{ path?: string }> }> = [];
    env.subscribeA((e: unknown) => {
      const evt = e as { type: string; value?: { operations?: Array<{ path?: string }> } };
      if (evt.type === "remote-change") {
        events.push({
          type: evt.type,
          operations: evt.value?.operations,
        });
      }
    });

    // ClientB edits a cell in Sheet2
    await env.storeB2.set(parseRef("A1"), { v: "hello" });
    await env.sync();

    // Verify at least one remote-change event has a cells path
    const cellPaths = events.flatMap(
      (e) => (e.operations ?? []).map((op) => op.path).filter(Boolean),
    );
    const hasCellPath = cellPaths.some((p) =>
      /^\$\.sheets\.[^.]+\.cells/.test(p!),
    );
    assert.equal(hasCellPath, true, `Expected cell path in: ${JSON.stringify(cellPaths)}`);
  } finally {
    await env.cleanup();
  }
});
```

- [x] **Step 2: Run tests against local Yorkie to verify they pass**

```bash
cd packages/frontend
YORKIE_RPC_ADDR=http://localhost:8080 npx tsx --test tests/app/spreadsheet/yorkie-cross-sheet.test.ts
```

Expected: all 5 tests pass (or skip if no Yorkie server).

- [x] **Step 3: Commit tests**

```bash
git add packages/frontend/tests/app/spreadsheet/yorkie-cross-sheet.test.ts
git commit -m "Add cross-sheet Yorkie integration tests

Five test cases covering: formula resolution after sync, value
updates via recalc, SUM with cross-sheet range, local dependent
chain propagation, and remote-change event path verification."
```
