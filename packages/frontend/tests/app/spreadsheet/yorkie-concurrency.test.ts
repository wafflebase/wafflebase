import assert from "node:assert/strict";
import test from "node:test";
import { concurrencyCases } from "../../../../sheet/test/helpers/concurrency-case-table.ts";
import { runConcurrentYorkieCase } from "../../helpers/two-user-yorkie.ts";

const shouldRunYorkieCases = Boolean(process.env.YORKIE_RPC_ADDR);

const serialIntentCases = concurrencyCases.filter((testCase) =>
  [
    "value edit vs row insert above shifted target",
    "value edit vs row delete at target",
    "value edit vs column insert left of shifted target",
    "value edit vs column delete at target",
    "row insert vs row insert at same index",
    "row insert vs row delete at same index",
    "column insert vs column insert at same index",
    "column insert vs column delete at same index",
    "row insert vs row insert at adjacent indexes",
    "row delete vs row insert at adjacent indexes",
  ].includes(testCase.name),
);

const characterizationCases = concurrencyCases.filter((testCase) =>
  [
    "column delete vs column delete at same index",
    "row delete vs row delete at same index",
  ].includes(testCase.name),
);

for (const testCase of serialIntentCases) {
  test(
    `Yorkie concurrency preserves serial intent: ${testCase.name}`,
    { skip: !shouldRunYorkieCases },
    async () => {
      const actual = await runConcurrentYorkieCase(testCase);

      assert.equal(actual.converged, true);
      assert.deepEqual(actual.collaboratorA, actual.collaboratorB);
      assert.equal(actual.matchesSerialOrder, true);
    },
  );
}

for (const testCase of characterizationCases) {
  test(
    `Yorkie concurrency characterization: ${testCase.name}`,
    { skip: !shouldRunYorkieCases },
    async () => {
      const actual = await runConcurrentYorkieCase(testCase);

      assert.equal(actual.converged, true);
      assert.deepEqual(actual.collaboratorA, actual.collaboratorB);
      assert.equal(actual.matchesSerialOrder, false);
    },
  );
}

test.skip(
  "Yorkie concurrency formula case is pending a Node runtime fix",
  () => {
    // The formula-shift case currently throws inside the sheet dist runtime
    // before the concurrency assertion phase begins.
  },
);
