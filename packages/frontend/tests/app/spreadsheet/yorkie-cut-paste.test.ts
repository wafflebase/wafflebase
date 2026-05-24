import { test, expect } from 'vitest';
import { parseRef, toSref } from "@wafflebase/sheets";
import { createSingleUserYorkie } from "../../helpers/single-user-yorkie.ts";

const shouldRun = Boolean(process.env.YORKIE_RPC_ADDR);

/**
 * Simulates the cut-paste batch sequence at the store level:
 *   1. beginBatch
 *   2. setGrid (paste destination values)
 *   3. delete source cells that don't overlap destination
 *   4. endBatch
 */

test(
  "YorkieStore batch: cut A1 paste A2 (no overlap) preserves pasted value",
  { skip: !shouldRun },
  async () => {
    const ctx = await createSingleUserYorkie("cut-paste-no-overlap");
    try {
      const { store } = ctx;

      // Seed: A1=1, A2=2
      await store.set(parseRef("A1"), { v: "1" });
      await store.set(parseRef("A2"), { v: "2" });

      // Simulate cut A1 → paste A2
      store.beginBatch();
      await store.setGrid(new Map([[toSref(parseRef("A2")), { v: "1" }]]));
      await store.delete(parseRef("A1"));
      store.endBatch();

      const a2 = await store.get(parseRef("A2"));
      const a1 = await store.get(parseRef("A1"));
      expect(a2?.v, "A2 should have pasted value 1").toBe("1");
      expect(a1, "A1 should be cleared").toBe(undefined);
    } finally {
      await ctx.cleanup();
    }
  },
);

test(
  "YorkieStore batch: cut A1:A2 paste A2 (overlapping) preserves pasted values",
  { skip: !shouldRun },
  async () => {
    const ctx = await createSingleUserYorkie("cut-paste-overlap");
    try {
      const { store } = ctx;

      // Seed: A1=1, A2=2, A3=3
      await store.set(parseRef("A1"), { v: "1" });
      await store.set(parseRef("A2"), { v: "2" });
      await store.set(parseRef("A3"), { v: "3" });

      // Simulate cut A1:A2 → paste starting at A2 (destination A2:A3)
      const pasteGrid = new Map([
        [toSref(parseRef("A2")), { v: "1" }],
        [toSref(parseRef("A3")), { v: "2" }],
      ]);

      store.beginBatch();
      await store.setGrid(pasteGrid);
      // Only delete source cells NOT in paste destination (A1 only)
      // A2 is in both source and destination — must NOT be deleted
      await store.delete(parseRef("A1"));
      store.endBatch();

      const a1 = await store.get(parseRef("A1"));
      const a2 = await store.get(parseRef("A2"));
      const a3 = await store.get(parseRef("A3"));
      expect(a1, "A1 should be cleared").toBe(undefined);
      expect(a2?.v, "A2 should have value from A1").toBe("1");
      expect(a3?.v, "A3 should have value from A2").toBe("2");
    } finally {
      await ctx.cleanup();
    }
  },
);
