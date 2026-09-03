import type { RevisionSummary } from '@yorkie-js/react';
import { readRevisionMeta, type RevisionMeta } from './revision-meta';

export type TimelineEntry = {
  id: string;
  label: string;
  createdAt: Date;
  meta: RevisionMeta;
};

export type TimelineDay = {
  /** Local-time `YYYY-MM-DD`. Display formatting belongs to the component. */
  dayKey: string;
  entries: TimelineEntry[];
};

/**
 * Turn a flat revision list into the day-grouped timeline the panel renders.
 *
 * Sorts defensively: `listRevisions` defaults to newest-first, but the
 * timeline's correctness should not depend on the server's ordering.
 */
export function groupRevisions(
  revisions: ReadonlyArray<RevisionSummary>,
): TimelineDay[] {
  const entries = revisions
    .map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt,
      meta: readRevisionMeta(r),
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const dayKey = toLocalDayKey(entry.createdAt);
    const last = days[days.length - 1];
    if (last?.dayKey === dayKey) last.entries.push(entry);
    else days.push({ dayKey, entries: [entry] });
  }
  return days;
}

function toLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
