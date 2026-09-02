/**
 * The `description` payload we write onto revisions we create.
 *
 * Yorkie's `RevisionSummary` has no author and no kind — only
 * `{id, label, description, snapshot, createdAt}` — so this is where
 * wafflebase records what a revision is and who made it. Revisions Yorkie
 * creates on its own (one per server snapshot) carry an empty description
 * and a `snapshot-<serverSeq>` label.
 */
export const AUTOMATIC_LABEL_PREFIX = 'snapshot-';

/** Payload schema version. Bump only on a breaking shape change. */
const META_VERSION = 1;

export type RevisionKind = 'named' | 'safety' | 'automatic';

export type RevisionMeta = {
  kind: RevisionKind;
  /** `User.id` of whoever created it. Absent on automatic revisions. */
  by?: number;
};

export function writeRevisionMeta(kind: 'named' | 'safety', by: number): string {
  return JSON.stringify({ v: META_VERSION, by, kind });
}

/**
 * Classify a revision. The description is authoritative — a user is free to
 * name a version `snapshot-503`, and the label prefix is only a fallback for
 * revisions wafflebase did not write.
 */
export function readRevisionMeta(revision: {
  label: string;
  description?: string;
}): RevisionMeta {
  const parsed = parseDescription(revision.description);
  if (parsed) return parsed;
  return { kind: 'automatic' };
}

function parseDescription(description?: string): RevisionMeta | null {
  if (!description) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(description);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { v, kind, by } = raw as Record<string, unknown>;
  if (v !== META_VERSION) return null;
  if (kind !== 'named' && kind !== 'safety') return null;
  return typeof by === 'number' ? { kind, by } : { kind };
}
