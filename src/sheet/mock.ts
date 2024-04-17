import { Cell } from './types';

/**
 * Mock data for testing.
 */
export const MockGrid: Array<[string, Cell]> = [
  ['A1', { v: '1' }],
  ['A2', { v: '2' }],
  ['A3', { f: '=SUM(A1,A2)', v: '3' }],
  ['B1', { v: '3' }],
  ['B2', { v: '4' }],
  ['B3', { f: '=SUM(B1:B2)', v: '7' }],
];
