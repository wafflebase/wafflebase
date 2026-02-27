import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlightRunner } from "./single-flight.ts";

test("createSingleFlightRunner coalesces concurrent calls", async () => {
  let runs = 0;
  let resolveRun: ((value: number) => void) | null = null;

  const runner = createSingleFlightRunner(async () => {
    runs += 1;
    return await new Promise<number>((resolve) => {
      resolveRun = resolve;
    });
  });

  const first = runner();
  const second = runner();
  const third = runner();

  assert.equal(runs, 1);
  resolveRun?.(7);

  const values = await Promise.all([first, second, third]);
  assert.deepEqual(values, [7, 7, 7]);
});

test("createSingleFlightRunner resets after resolution", async () => {
  let runs = 0;
  const runner = createSingleFlightRunner(async () => {
    runs += 1;
    return runs;
  });

  const first = await runner();
  const second = await runner();

  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(runs, 2);
});

test("createSingleFlightRunner resets after rejection", async () => {
  let runs = 0;
  const runner = createSingleFlightRunner(async () => {
    runs += 1;
    if (runs === 1) {
      throw new Error("boom");
    }
    return runs;
  });

  await assert.rejects(() => runner(), /boom/);
  const next = await runner();

  assert.equal(next, 2);
  assert.equal(runs, 2);
});
