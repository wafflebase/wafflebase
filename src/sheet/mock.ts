import { Cell } from './types';

/**
 * Mock data for testing.
 */
export const MockGrid: Array<[string, Cell]> = [
  ['A1', { v: '1' }],
  ['A2', { v: '2' }],
  ['A3', { v: '3' }],
  ['A4', { f: '=SUM(A1,A2,A3)', v: '6' }],
];
