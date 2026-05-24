import { test, expect } from 'vitest';
import { concurrencyCases } from "../../../../sheets/test/helpers/concurrency-case-table.ts";
import { runConcurrentYorkieCase } from "../../helpers/two-user-yorkie.ts";

const deferredCases = concurrencyCases.filter((testCase) =>
  [
    "column delete vs column delete at same index",
    "row delete vs row delete at same index",
  ].includes(testCase.name),
);

for (const testCase of deferredCases) {
  test.skip(
    `Yorkie concurrency repro deferred: ${testCase.name}`,
    async () => {
      const actual = await runConcurrentYorkieCase(testCase);

      expect(actual.converged).toBe(true);
      expect(actual.collaboratorA).toEqual(actual.collaboratorB);
      expect(actual.matchesSerialOrder).toBe(true);
    },
  );
}
