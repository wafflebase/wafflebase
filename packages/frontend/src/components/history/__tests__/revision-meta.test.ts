import { describe, expect, it } from 'vitest';
import {
  readRevisionMeta,
  writeRevisionMeta,
} from '../revision-meta';

describe('writeRevisionMeta', () => {
  it('serializes the versioned payload', () => {
    expect(writeRevisionMeta('named', 42)).toBe('{"v":1,"by":42,"kind":"named"}');
  });
});

describe('readRevisionMeta', () => {
  it('reads a named revision we wrote', () => {
    expect(
      readRevisionMeta({ label: 'Before the rewrite', description: writeRevisionMeta('named', 42) }),
    ).toEqual({ kind: 'named', by: 42 });
  });

  it('reads a safety revision we wrote', () => {
    expect(
      readRevisionMeta({ label: 'Before restore', description: writeRevisionMeta('safety', 7) }),
    ).toEqual({ kind: 'safety', by: 7 });
  });

  it("treats Yorkie's own snapshot revisions as automatic", () => {
    expect(readRevisionMeta({ label: 'snapshot-503', description: '' })).toEqual({
      kind: 'automatic',
    });
  });

  // A user may name a version "snapshot-503". The description is authoritative;
  // the label prefix is only a fallback for revisions we did not write.
  it('prefers the description over a colliding label', () => {
    expect(
      readRevisionMeta({ label: 'snapshot-503', description: writeRevisionMeta('named', 42) }),
    ).toEqual({ kind: 'named', by: 42 });
  });

  it('falls back to automatic on a malformed description', () => {
    expect(readRevisionMeta({ label: 'snapshot-9', description: 'not json' })).toEqual({
      kind: 'automatic',
    });
  });

  // Forward compatibility: a payload from a future version is not ours to read.
  it('falls back to automatic on an unknown payload version', () => {
    expect(
      readRevisionMeta({ label: 'x', description: '{"v":2,"by":1,"kind":"named"}' }),
    ).toEqual({ kind: 'automatic' });
  });

  it('drops a non-numeric author rather than trusting it', () => {
    expect(
      readRevisionMeta({ label: 'x', description: '{"v":1,"by":"42","kind":"named"}' }),
    ).toEqual({ kind: 'named' });
  });
});
