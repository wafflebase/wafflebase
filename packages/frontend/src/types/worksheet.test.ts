import { describe, it, expect } from 'vitest';
import {
  initialSpreadsheetDocument,
  sheetsInitialRootForRole,
} from './worksheet';

describe('sheetsInitialRootForRole', () => {
  // The SDK writes every absent `initialRoot` key on each attach, so seeding
  // from a viewer's client means a viewer creates the whole workbook on a
  // never-edited spreadsheet just by opening the share link.
  it('seeds nothing for a viewer', () => {
    expect(sheetsInitialRootForRole('viewer')).toEqual({});
  });

  it('still seeds a workbook for anyone who can write', () => {
    expect(sheetsInitialRootForRole('editor').tabOrder).toHaveLength(1);
    expect(sheetsInitialRootForRole('owner').tabOrder).toHaveLength(1);
  });
});

describe('initialSpreadsheetDocument', () => {
  // Shared by the react provider, `apply-imported-content`'s plain
  // `@yorkie-js/sdk` client, and ~18 backend attach sites. A CRDT value here
  // would be recognized by only one realm — the trap docs walked into.
  it('seeds no value whose class identity matters', () => {
    const seen = new Set<unknown>();
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);
      expect(Array.isArray(value) || value.constructor === Object).toBe(true);
      Object.values(value).forEach(walk);
    };
    walk(initialSpreadsheetDocument());
  });
});
