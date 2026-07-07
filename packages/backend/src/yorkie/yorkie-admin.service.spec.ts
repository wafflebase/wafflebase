import { parseTimestamp, projectSummary } from './yorkie-admin.service';

describe('projectSummary', () => {
  it('reads the last-modified time from camelCase `updatedAt`', () => {
    // Yorkie's connect-go protojson response marshals fields as camelCase.
    // Regression guard: reading snake_case here silently loses the value.
    const summary = projectSummary({
      key: 'doc-1',
      updatedAt: '2024-03-04T05:06:07.000Z',
    });
    expect(summary.updatedAt).toBe('2024-03-04T05:06:07.000Z');
  });

  it('falls back to snake_case `updated_at` when present', () => {
    const summary = projectSummary({
      key: 'doc-1',
      updated_at: '2024-03-04T05:06:07.000Z',
    });
    expect(summary.updatedAt).toBe('2024-03-04T05:06:07.000Z');
  });

  it('leaves updatedAt undefined when the document has no timestamp', () => {
    expect(projectSummary({ key: 'doc-1' }).updatedAt).toBeUndefined();
  });

  it('projects the currently-editing users from presences', () => {
    const summary = projectSummary({
      key: 'doc-1',
      presences: {
        c1: { data: { username: '"alice"', email: '"a@x.io"' } },
      },
    });
    expect(summary.editors).toEqual([
      { username: 'alice', email: 'a@x.io', photo: undefined },
    ]);
  });
});

describe('parseTimestamp', () => {
  it('normalizes an RFC3339 timestamp to an ISO string', () => {
    expect(parseTimestamp('2024-01-02T03:04:05.678Z')).toBe(
      '2024-01-02T03:04:05.678Z',
    );
  });

  it('normalizes a non-UTC offset to UTC ISO', () => {
    expect(parseTimestamp('2024-01-02T12:00:00+09:00')).toBe(
      '2024-01-02T03:00:00.000Z',
    );
  });

  it('returns undefined for missing or empty values', () => {
    expect(parseTimestamp(undefined)).toBeUndefined();
    expect(parseTimestamp('')).toBeUndefined();
  });

  it('returns undefined for epoch-zero (Yorkie "unset") timestamps', () => {
    expect(parseTimestamp('1970-01-01T00:00:00Z')).toBeUndefined();
  });

  it('returns undefined for unparseable values', () => {
    expect(parseTimestamp('not-a-date')).toBeUndefined();
  });
});
