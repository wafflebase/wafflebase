import { Cell } from './types';

/**
 * Mock data for testing.
 */
export const MockGrid: Array<[string, Cell]> = [
  // 01. Formula with references

  ['A1', { v: 'Reference' }],
  ['A2', { v: '1' }],
  ['A3', { v: '2' }],
  ['A4', { f: '=SUM(A2,A3)' }],

  // 02. Formula with range
  ['B1', { v: 'Range' }],
  ['B2', { v: '3' }],
  ['B3', { v: '4' }],
  ['B4', { f: '=SUM(B2:B3)' }],

  // 03. Formula with circular reference
  ['C1', { v: 'Cycle' }],
  ['C2', { f: '=C3+10' }],
  ['C3', { f: '=C2+10' }],

  // 04. Not enough arguments
  ['D1', { v: 'Arguments' }],
  ['D2', { f: '=SUM()' }],

  // 05. Invalid arguments
  ['E1', { v: 'RefRange' }],
  ['E2', { v: '1' }],
  ['E3', { f: '=E1:E2' }],
];
