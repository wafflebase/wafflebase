import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { groupRevisions } from '../group-revisions';
import { writeRevisionMeta } from '../revision-meta';

// Construct dates from local components to ensure timezone-independent tests.
// Month is 0-based, so 8 = September.
const rev = (
  id: string,
  label: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number = 0,
  description = '',
) => ({
  id,
  label,
  description,
  snapshot: '',
  createdAt: new Date(year, month, day, hour, minute),
});

// Pin the timezone to ensure the local-time contract is guarded even on UTC
// runners (GitHub Actions). This ensures that a regression to getUTC* would
// be caught reliably. Node re-reads process.env.TZ for every new Date().
const previousTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Asia/Seoul'; // UTC+9, no DST
});

afterAll(() => {
  process.env.TZ = previousTZ;
});

describe('groupRevisions', () => {
  it('groups by local day, newest day first and newest entry first', () => {
    const days = groupRevisions([
      rev('c', 'snapshot-9', 2026, 8, 2, 10), // Sep 2 10:00
      rev('b', 'snapshot-8', 2026, 8, 1, 18), // Sep 1 18:00
      rev('a', 'snapshot-7', 2026, 8, 1, 9), // Sep 1 09:00
    ]);
    expect(days.map((d) => d.dayKey)).toEqual(['2026-09-02', '2026-09-01']);
    expect(days[1].entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('classifies each entry', () => {
    const [day] = groupRevisions([
      rev('n', 'Launch copy', 2026, 8, 2, 10, 0, writeRevisionMeta('named', 42)),
      rev('s', 'snapshot-3', 2026, 8, 2, 9),
    ]);
    expect(day.entries.map((e) => e.meta.kind)).toEqual(['named', 'automatic']);
    expect(day.entries[0].meta.by).toBe(42);
  });

  it('returns no days for no revisions', () => {
    expect(groupRevisions([])).toEqual([]);
  });

  // listRevisions defaults to newest-first, but the panel must not depend on
  // the server's ordering to render a correct timeline.
  it('sorts input it was handed out of order', () => {
    const days = groupRevisions([
      rev('old', 'snapshot-1', 2026, 8, 1, 9),
      rev('new', 'snapshot-2', 2026, 8, 2, 10),
    ]);
    expect(days.map((d) => d.dayKey)).toEqual(['2026-09-02', '2026-09-01']);
  });

  // Pin the local-time contract: a revision at 00:30 local time groups
  // under that day, not the previous day. UTC would file it under the
  // previous day for any timezone ahead of UTC.
  it('groups by local day at midnight boundary', () => {
    const days = groupRevisions([
      rev('before', 'snapshot-x', 2026, 8, 2, 0, 30), // Sep 2 00:30 local
      rev('after', 'snapshot-y', 2026, 8, 1, 23, 30), // Sep 1 23:30 local
    ]);
    expect(days.map((d) => d.dayKey)).toEqual(['2026-09-02', '2026-09-01']);
    expect(days[0].entries.map((e) => e.id)).toEqual(['before']);
    expect(days[1].entries.map((e) => e.id)).toEqual(['after']);
  });
});
