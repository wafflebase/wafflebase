import { test, expect } from 'vitest';
import { createSingleFlightRunner } from "../../src/api/single-flight.ts";

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

  expect(runs).toBe(1);
  resolveRun?.(7);

  const values = await Promise.all([first, second, third]);
  expect(values).toEqual([7, 7, 7]);
});

test("createSingleFlightRunner resets after resolution", async () => {
  let runs = 0;
  const runner = createSingleFlightRunner(async () => {
    runs += 1;
    return runs;
  });

  const first = await runner();
  const second = await runner();

  expect(first).toBe(1);
  expect(second).toBe(2);
  expect(runs).toBe(2);
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

  await expect(runner()).rejects.toThrow(/boom/);
  const next = await runner();

  expect(next).toBe(2);
  expect(runs).toBe(2);
});
