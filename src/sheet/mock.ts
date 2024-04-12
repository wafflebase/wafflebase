import { Cell } from './types';

/**
 * Mock data for testing.
 */
export const MockGrid: Array<[string, Cell]> = [
  ['A1', 1],
  ['A2', 2],
  ['A3', 3],
  // TODO(hackerwins): Formula evalution.
  // ['A4', '=SUM(A1:A3)'],
];
