import assert from "node:assert/strict";
import test from "node:test";
import { concurrencyCases } from "../../../../sheet/test/helpers/concurrency-case-table.ts";
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

      assert.equal(actual.converged, true);
      assert.deepEqual(actual.collaboratorA, actual.collaboratorB);
      assert.equal(actual.matchesSerialOrder, true);
    },
  );
}
