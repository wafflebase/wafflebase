import { describe, expect, it } from 'vitest';
import { concurrencyCases } from '../helpers/concurrency-case-table';
import { runSerialConcurrencyCase } from '../helpers/concurrency-driver';

describe('Sheet concurrency matrix (serial intent oracle)', () => {
  for (const testCase of concurrencyCases) {
    it(testCase.name, async () => {
      const actual = await runSerialConcurrencyCase(testCase);
      expect(actual).toEqual(testCase.expect);
    });
  }
});
