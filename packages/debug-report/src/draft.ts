/**
 * The agent-written issue text, and the PR shape it proposes.
 *
 * Two things live here: the schema the drafting call is held to, and the
 * operations the reporter performs on what comes back. Both are in the core
 * package rather than in the UI because both are rules — what a valid draft is,
 * and what regrouping may and may not do — and rules belong somewhere testable.
 *
 * WHY THE DRAFT HAPPENS BEFORE CONFIRMATION. The thing the reporter is
 * confirming IS the issue text. Showing them their own sentence and running the
 * agent afterwards would ask them to approve something they have not seen, so
 * the model call sits at preview time and the credential question is answered by
 * making that call tool-free and output-only (see *Credentials* in
 * `docs/design/debug-report.md`).
 *
 * WHAT THE PROPOSAL CANNOT KNOW. Elective coupling — same kind, same risk —
 * needs only the items. Forced coupling needs to know which files each change
 * touches, which needs a repository, which the browser does not have. So a
 * proposal is a SHAPE, never a promise about the number of PRs, and the
 * repository side reports every adjustment as a delta.
 */

import { CHANGE_KINDS, SEVERITIES, type ChangeKind, type Draft, type ProposedGroup } from './types';

/** At most this many items in one PR. */
export const MAX_GROUP_ITEMS = 8;

/** At most this many PRs from one session; the rest stay queued and visible. */
export const MAX_SESSION_PRS = 5;

/**
 * Kinds that group with their own kind.
 *
 * `layout` is absent because a structural change's blast radius differs per
 * file, so it groups only by file — a decision the repository side makes.
 * `logic` is absent because one blocked behaviour fix should never hold up the
 * others (`docs/design/debug-report.md`, the grouping table).
 */
export const ELECTIVELY_GROUPED: readonly ChangeKind[] = [
  'spacing',
  'color',
  'token',
  'copy',
  'a11y',
  'affordance',
];

/** Kinds that are never grouped, whatever else is in the batch. */
export const NEVER_GROUPED: readonly ChangeKind[] = ['logic'];

/**
 * The JSON Schema the drafting call is held to.
 *
 * `additionalProperties: false` on every object because structured outputs
 * requires it, and because a field nobody declared is a field nothing validates.
 */
export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          itemId: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          severity: { type: 'string', enum: [...SEVERITIES] },
          kind: { type: 'string', enum: [...CHANGE_KINDS] },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['itemId', 'title', 'body', 'severity', 'kind', 'labels'],
      },
    },
    proposedGroups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: [...CHANGE_KINDS] },
          itemIds: { type: 'array', items: { type: 'string' } },
          prTitle: { type: 'string' },
        },
        required: ['id', 'kind', 'itemIds', 'prTitle'],
      },
    },
  },
  required: ['drafts', 'proposedGroups'],
} as const;

export type ItemDraft = { itemId: string; draft: Draft };

export type DraftResult = {
  drafts: ItemDraft[];
  proposedGroups: ProposedGroup[];
};

export type DraftParse =
  | { ok: true; result: DraftResult; dropped: string[] }
  | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

/**
 * Validate a drafting response against the items it is supposed to describe.
 *
 * Fail-closed on SHAPE — a response that is not the schema is rejected outright,
 * because the alternative is a panel rendering half a draft as if it were whole.
 * But an individual draft naming an item that does not exist is DROPPED and
 * reported, not fatal: one hallucinated id should not cost the reporter the other
 * nine drafts they were waiting for, and the drop is visible.
 */
export function parseDraftResult(input: unknown, itemIds: readonly string[]): DraftParse {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`draft: not valid JSON (${String(err)})`] };
    }
  }
  if (!isRecord(value)) return { ok: false, errors: ['draft: expected an object'] };
  if (!Array.isArray(value.drafts)) {
    return { ok: false, errors: ['draft.drafts: expected an array'] };
  }
  if (value.proposedGroups !== undefined && !Array.isArray(value.proposedGroups)) {
    return { ok: false, errors: ['draft.proposedGroups: expected an array'] };
  }

  const known = new Set(itemIds);
  const errors: string[] = [];
  const dropped: string[] = [];
  const drafts: ItemDraft[] = [];
  const seen = new Set<string>();

  value.drafts.forEach((raw, i) => {
    const at = `draft.drafts[${i}]`;
    if (!isRecord(raw)) return void errors.push(`${at}: expected an object`);
    if (!isNonEmptyString(raw.itemId)) {
      return void errors.push(`${at}.itemId: expected a non-empty string`);
    }
    if (!known.has(raw.itemId)) {
      dropped.push(`${raw.itemId} (no such item)`);
      return;
    }
    if (seen.has(raw.itemId)) {
      dropped.push(`${raw.itemId} (drafted twice)`);
      return;
    }
    if (!isNonEmptyString(raw.title)) {
      return void errors.push(`${at}.title: expected a non-empty string`);
    }
    if (typeof raw.body !== 'string') {
      return void errors.push(`${at}.body: expected a string`);
    }
    if (!SEVERITIES.includes(raw.severity as never)) {
      return void errors.push(`${at}.severity: expected one of ${SEVERITIES.join(' | ')}`);
    }
    if (!CHANGE_KINDS.includes(raw.kind as never)) {
      return void errors.push(`${at}.kind: expected one of ${CHANGE_KINDS.join(' | ')}`);
    }
    const labels = Array.isArray(raw.labels)
      ? raw.labels.filter(isNonEmptyString)
      : [];
    seen.add(raw.itemId);
    drafts.push({
      itemId: raw.itemId,
      draft: {
        title: raw.title,
        body: raw.body,
        severity: raw.severity as Draft['severity'],
        kind: raw.kind as ChangeKind,
        labels,
      },
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  const groups = normaliseGroups(
    Array.isArray(value.proposedGroups) ? value.proposedGroups : [],
    drafts,
    dropped,
  );
  return { ok: true, result: { drafts, proposedGroups: groups }, dropped };
}

/**
 * Bring a proposed grouping into line with the rules, reporting what changed.
 *
 * The model proposes; this decides. Unknown ids are dropped, an item claimed
 * twice stays with the first claimant, `logic` items are split out, **a group is
 * reduced to ONE KIND**, groups are capped, and anything left over becomes its
 * own PR — so the panel always has a complete, legal shape to render even when
 * the proposal was not one.
 *
 * HOMOGENEITY IS THE RULE, and it was the one this function did not check.
 * Nothing compared one member's kind to another's, so a `layout` item — whose
 * blast radius differs per file, which is exactly why it groups alone — could
 * ride along inside a spacing PR. Worse, the group's declared `kind` was trusted
 * over its members', so a group could be LABELLED `logic` while carrying three
 * spacing fixes, and that label is what the pipeline routes on.
 */
function normaliseGroups(
  raw: readonly unknown[],
  drafts: readonly ItemDraft[],
  dropped: string[],
): ProposedGroup[] {
  const kindOf = new Map(drafts.map((d) => [d.itemId, d.draft.kind]));
  const claimed = new Set<string>();
  const groups: ProposedGroup[] = [];

  raw.forEach((entry, i) => {
    if (!isRecord(entry)) return;
    const ids = Array.isArray(entry.itemIds) ? entry.itemIds.filter(isNonEmptyString) : [];
    const eligible = ids.filter((id) => {
      if (!kindOf.has(id)) {
        dropped.push(`${id} (grouped but not drafted)`);
        return false;
      }
      if (claimed.has(id)) {
        dropped.push(`${id} (claimed by two groups)`);
        return false;
      }
      // A kind that is never grouped leaves here rather than being silently
      // carried along; it gets its own PR below.
      if (NEVER_GROUPED.includes(kindOf.get(id)!)) return false;
      // Nor does a kind that only groups by file, which the browser cannot know.
      if (!ELECTIVELY_GROUPED.includes(kindOf.get(id)!)) return false;
      return true;
    });
    if (eligible.length === 0) return;

    // THE GROUP'S KIND COMES FROM ITS MEMBERS, not from the model's label: the
    // label is what the pipeline routes on, and a wrong one sends a spacing
    // cleanup down the behaviour-fix path. The first eligible member decides,
    // and anything of another kind leaves — it will get its own PR, which is
    // what the rules would have produced anyway.
    const kind = kindOf.get(eligible[0])!;
    const members = eligible.filter((id) => kindOf.get(id) === kind);
    for (const id of members.slice(0, MAX_GROUP_ITEMS)) claimed.add(id);
    groups.push({
      id: isNonEmptyString(entry.id) ? entry.id : `g${i + 1}`,
      kind,
      itemIds: members.slice(0, MAX_GROUP_ITEMS),
      prTitle: isNonEmptyString(entry.prTitle)
        ? entry.prTitle
        : titleFor(drafts, members[0]),
    });
  });

  // Everything not in a legal group becomes its own PR. An ungrouped item is a
  // normal state — `logic` is never grouped, and drafting may be unavailable
  // entirely — so this is the default shape rather than an error path.
  for (const { itemId } of drafts) {
    if (claimed.has(itemId)) continue;
    groups.push({
      id: `solo-${itemId}`,
      kind: kindOf.get(itemId)!,
      itemIds: [itemId],
      prTitle: titleFor(drafts, itemId),
    });
  }
  return dedupeGroupIds(groups);
}

function titleFor(drafts: readonly ItemDraft[], itemId: string): string {
  return drafts.find((d) => d.itemId === itemId)?.draft.title ?? 'Report';
}

/** Group ids must be unique for the reporter's operations to address them. */
function dedupeGroupIds(groups: readonly ProposedGroup[]): ProposedGroup[] {
  const seen = new Set<string>();
  return groups.map((group) => {
    let id = group.id;
    let n = 2;
    while (seen.has(id)) id = `${group.id}-${n++}`;
    seen.add(id);
    return id === group.id ? group : { ...group, id };
  });
}

/**
 * A grouping with no drafting at all: one item, one PR.
 *
 * The path taken when no model credential is configured. Drafting is an
 * accelerator, never a dependency — without it the reporter's own sentences are
 * the issue text and the pipeline still runs.
 */
export function ungrouped(items: ReadonlyArray<{ id: string; note: string }>): ProposedGroup[] {
  return items.map((item) => ({
    id: `solo-${item.id}`,
    kind: 'logic' as ChangeKind,
    itemIds: [item.id],
    prTitle: item.note.slice(0, 70),
  }));
}

// ── The three operations the reporter has ──────────────────────────────────
//
// Detach, split, merge. Deliberately no file-shaped operation: the browser
// cannot know which files an item touches, so offering one would invite a
// decision the reporter has no information for.

/** Take one item out of its group; it becomes its own PR. */
export function detachItem(
  groups: readonly ProposedGroup[],
  itemId: string,
  titleOf: (itemId: string) => string,
): ProposedGroup[] {
  const source = groups.find((g) => g.itemIds.includes(itemId));
  if (!source || source.itemIds.length === 1) return [...groups];
  const kept = groups.map((group) =>
    group.id === source.id
      ? { ...group, itemIds: group.itemIds.filter((id) => id !== itemId) }
      : group,
  );
  return dedupeGroupIds([
    ...kept,
    {
      id: `solo-${itemId}`,
      kind: source.kind,
      itemIds: [itemId],
      prTitle: titleOf(itemId),
    },
  ]);
}

/** Break a group into one PR per item. */
export function splitGroup(
  groups: readonly ProposedGroup[],
  groupId: string,
  titleOf: (itemId: string) => string,
): ProposedGroup[] {
  const target = groups.find((g) => g.id === groupId);
  if (!target || target.itemIds.length <= 1) return [...groups];
  const out: ProposedGroup[] = [];
  for (const group of groups) {
    if (group.id !== groupId) {
      out.push(group);
      continue;
    }
    for (const itemId of group.itemIds) {
      out.push({
        id: `solo-${itemId}`,
        kind: group.kind,
        itemIds: [itemId],
        prTitle: titleOf(itemId),
      });
    }
  }
  return dedupeGroupIds(out);
}

export type MergeResult = {
  groups: ProposedGroup[];
  /** Set when the merge crossed kinds or hit the cap. Warned about, never blocked. */
  warning?: string;
};

/**
 * Merge two groups.
 *
 * Crossing kinds is WARNED ABOUT, NOT BLOCKED. The rules exist because uniform
 * verdicts move together, but the reporter knows things the rules do not, and a
 * tool that silently overrides its user teaches them to distrust it. Exceeding
 * the per-group cap is the same: the merge stands and the panel says the
 * repository side will have to split it.
 */
export function mergeGroups(
  groups: readonly ProposedGroup[],
  aId: string,
  bId: string,
): MergeResult {
  const a = groups.find((g) => g.id === aId);
  const b = groups.find((g) => g.id === bId);
  if (!a || !b || a.id === b.id) return { groups: [...groups] };

  const itemIds = [...a.itemIds, ...b.itemIds];
  const warnings: string[] = [];
  if (a.kind !== b.kind) {
    warnings.push(
      `${a.kind} and ${b.kind} are different kinds of change, so one being blocked will block the other.`,
    );
  }
  if (itemIds.length > MAX_GROUP_ITEMS) {
    warnings.push(
      `${itemIds.length} items exceeds the ${MAX_GROUP_ITEMS}-item limit, so the pipeline will split this again and report the delta.`,
    );
  }
  if (NEVER_GROUPED.includes(a.kind) || NEVER_GROUPED.includes(b.kind)) {
    warnings.push(
      'A behaviour fix is normally kept on its own so that one blocked review does not hold up the rest.',
    );
  }

  const merged: ProposedGroup = {
    id: a.id,
    kind: a.kind,
    itemIds,
    prTitle: a.prTitle,
  };
  const out = groups
    .filter((g) => g.id !== b.id)
    .map((g) => (g.id === a.id ? merged : g));
  return {
    groups: out,
    ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
  };
}

/**
 * The groups that fit inside the per-session PR ceiling, and the items that do not.
 *
 * Overflow is QUEUED AND SHOWN, not dropped: twenty items becoming twenty PRs
 * would lock up CI, and a cap the reporter cannot see is indistinguishable from
 * losing their reports.
 */
export function withinSessionCap(
  groups: readonly ProposedGroup[],
  cap = MAX_SESSION_PRS,
): { send: ProposedGroup[]; queued: ProposedGroup[] } {
  return { send: groups.slice(0, cap), queued: groups.slice(cap) };
}
