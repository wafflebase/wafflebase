import { EvalNode } from './formula';
import { mathEntries } from './functions-math';
import { statisticalEntries } from './functions-statistical';
import { textEntries } from './functions-text';
import { lookupEntries } from './functions-lookup';
import { dateEntries } from './functions-date';
import { logicalEntries } from './functions-logical';
import { financialEntries } from './functions-financial';
import { engineeringEntries } from './functions-engineering';
import { databaseEntries } from './functions-database';
import { infoEntries } from './functions-info';

/**
 * FunctionMap is a map of function name to the function implementation.
 */
export const FunctionMap = new Map<string, (...args: any[]) => EvalNode>([
  ...mathEntries,
  ...statisticalEntries,
  ...textEntries,
  ...lookupEntries,
  ...dateEntries,
  ...logicalEntries,
  ...financialEntries,
  ...engineeringEntries,
  ...databaseEntries,
  ...infoEntries,
]);
