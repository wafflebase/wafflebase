import assert from "node:assert/strict";
import test from "node:test";
import { parseRef } from "@wafflebase/sheet";
import { setupCrossSheetEnv } from "../../helpers/cross-sheet-yorkie.ts";
import { needsRecalc } from "../../../src/app/spreadsheet/remote-change-utils.ts";

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
    const events: Array<{
      type: string;
      operations?: Array<{ path?: string }>;
    }> = [];
    env.subscribeA((e: unknown) => {
      const evt = e as {
        type: string;
        value?: { operations?: Array<{ path?: string }> };
      };
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
    const cellPaths = events.flatMap((e) =>
      (e.operations ?? []).map((op) => op.path).filter(Boolean),
    );
    const hasCellPath = cellPaths.some((p) =>
      /^\$\.sheets\.[^.]+\.cells/.test(p!),
    );
    assert.equal(
      hasCellPath,
      true,
      `Expected cell path in: ${JSON.stringify(cellPaths)}`,
    );
  } finally {
    await env.cleanup();
  }
});

test("remote-change event for style edit does not need recalc", { skip: !shouldRun }, async () => {
  const env = await setupCrossSheetEnv("style-event-path");
  try {
    const events: Array<{
      type: string;
      operations?: Array<{ path?: string }>;
    }> = [];
    env.subscribeA((e: unknown) => {
      const evt = e as {
        type: string;
        value?: { operations?: Array<{ path?: string }> };
      };
      if (evt.type === "remote-change") {
        events.push({
          type: evt.type,
          operations: evt.value?.operations,
        });
      }
    });

    // ClientB applies a range style (background color) to Sheet2
    await env.storeB2.addRangeStyle({
      startRef: parseRef("A1"),
      endRef: parseRef("B3"),
      style: { bgColor: "#ff0000" },
    });
    await env.sync();

    // Verify remote-change events contain rangeStyles path, not cells
    const allPaths = events.flatMap((e) =>
      (e.operations ?? []).map((op) => op.path).filter(Boolean),
    );
    const hasStylePath = allPaths.some((p) =>
      /^\$\.sheets\.[^.]+\.rangeStyles/.test(p!),
    );
    assert.equal(
      hasStylePath,
      true,
      `Expected rangeStyles path in: ${JSON.stringify(allPaths)}`,
    );

    // The style-only operations should NOT require formula recalculation
    for (const e of events) {
      assert.equal(
        needsRecalc(e.operations),
        false,
        `Style-only event should not need recalc: ${JSON.stringify(e.operations?.map((op) => op.path))}`,
      );
    }
  } finally {
    await env.cleanup();
  }
});

test("remote-change event for dimension edit does not need recalc", { skip: !shouldRun }, async () => {
  const env = await setupCrossSheetEnv("dimension-event-path");
  try {
    const events: Array<{
      type: string;
      operations?: Array<{ path?: string }>;
    }> = [];
    env.subscribeA((e: unknown) => {
      const evt = e as {
        type: string;
        value?: { operations?: Array<{ path?: string }> };
      };
      if (evt.type === "remote-change") {
        events.push({
          type: evt.type,
          operations: evt.value?.operations,
        });
      }
    });

    // ClientB changes a column width in Sheet2
    await env.storeB2.setDimensionSize("col", 2, 200);
    await env.sync();

    const allPaths = events.flatMap((e) =>
      (e.operations ?? []).map((op) => op.path).filter(Boolean),
    );
    const hasDimPath = allPaths.some((p) =>
      /^\$\.sheets\.[^.]+\.colWidths/.test(p!),
    );
    assert.equal(
      hasDimPath,
      true,
      `Expected colWidths path in: ${JSON.stringify(allPaths)}`,
    );

    for (const e of events) {
      assert.equal(
        needsRecalc(e.operations),
        false,
        `Dimension-only event should not need recalc: ${JSON.stringify(e.operations?.map((op) => op.path))}`,
      );
    }
  } finally {
    await env.cleanup();
  }
});
