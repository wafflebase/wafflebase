import assert from "node:assert/strict";
import test from "node:test";
import { concurrencyCases } from "../../../../sheet/test/helpers/concurrency-case-table.ts";
import { runConcurrentYorkieCase } from "../../helpers/two-user-yorkie.ts";

const shouldRunKnownFailures =
  Boolean(process.env.YORKIE_RPC_ADDR) &&
  process.env.YORKIE_RUN_KNOWN_FAILURES === "1";

const knownFailingCases = concurrencyCases.filter((testCase) =>
  [
    "row insert vs row insert at same index",
    "row insert vs row delete at same index",
    "column insert vs column insert at same index",
    "column insert vs column delete at same index",
    "column delete vs column delete at same index",
    "row delete vs row delete at same index",
    "row insert vs row insert at adjacent indexes",
    "row delete vs row insert at adjacent indexes",
  ].includes(testCase.name),
);

for (const testCase of knownFailingCases) {
  test(
    `Yorkie concurrency repro: ${testCase.name}`,
    { skip: !shouldRunKnownFailures },
    async () => {
      const actual = await runConcurrentYorkieCase(testCase);

      assert.equal(actual.converged, true);
      assert.deepEqual(actual.collaboratorA, actual.collaboratorB);

      // This is the desired contract. It currently fails for these cases and is
      // kept as an opt-in reproduction slice.
      assert.equal(actual.matchesSerialOrder, true);
    },
  );
}
