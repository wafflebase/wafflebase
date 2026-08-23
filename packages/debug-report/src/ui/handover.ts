/**
 * Handing a batch over: ask for drafts, then send what the reporter confirmed.
 *
 * Orchestration lives here rather than in the panel because these are the steps
 * with rules in them — what happens when drafting is unavailable, which items
 * travel, which captures travel with them, and what the reporter is told
 * afterwards. The panel's job is to render this and take the decisions.
 *
 * Design: `docs/design/debug-report.md`.
 */

import {
  buildBundle,
  parseDraftResult,
  summariseBundle,
  ungrouped,
  withinSessionCap,
  type Bundle,
  type CaptureStore,
  type DebugItem,
  type Draft,
  type HostAdapter,
  type ProposedGroup,
  type SendResult,
} from "../index";

/** What the panel knows about the drafting attempt. */
export type DraftState =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "ready"; drafted: number; dropped: string[] }
  /**
   * Drafting is UNAVAILABLE, not broken. No credential is the common case, and
   * the batch still goes: the reporter's own sentences are the issue text and
   * every item becomes its own PR. Saying which of the two happened matters —
   * "not configured" is an instruction, "failed" is a retry.
   */
  | { status: "unavailable"; reason: string; detail: string };

export type DraftOutcome = {
  state: DraftState;
  drafts: Map<string, Draft>;
  groups: ProposedGroup[];
};

/**
 * Ask the host for issue text and a proposed grouping.
 *
 * Never throws: every failure becomes an `unavailable` state with a reason,
 * because a batch that cannot be handed over because drafting failed would make
 * the model call a dependency rather than the accelerator it is.
 */
export async function requestDrafts(
  host: Pick<HostAdapter, "draft">,
  items: readonly DebugItem[],
): Promise<DraftOutcome> {
  const fallback = (state: DraftState): DraftOutcome => ({
    state,
    drafts: new Map(),
    groups: ungrouped(items.map((item) => ({ id: item.id, note: item.note }))),
  });

  if (items.length === 0) {
    return fallback({ status: "unavailable", reason: "empty", detail: "nothing collected yet" });
  }

  let raw: unknown;
  try {
    raw = await host.draft(items);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const notConfigured = /not-configured|no model credential/i.test(detail);
    return fallback({
      status: "unavailable",
      reason: notConfigured ? "not-configured" : "failed",
      detail,
    });
  }

  const parsed = parseDraftResult(raw, items.map((item) => item.id));
  if (!parsed.ok) {
    // A malformed draft is refused rather than half-rendered: the panel would
    // otherwise show some issue text as if it were the whole answer.
    return fallback({
      status: "unavailable",
      reason: "malformed",
      detail: parsed.errors.slice(0, 3).join("; "),
    });
  }

  return {
    state: {
      status: "ready",
      drafted: parsed.result.drafts.length,
      dropped: parsed.dropped,
    },
    drafts: new Map(parsed.result.drafts.map((d) => [d.itemId, d.draft])),
    groups: parsed.result.proposedGroups,
  };
}

export type HandoverResult = {
  sent: SendResult;
  bundle: Bundle;
  /** PRs the per-session cap held back. Queued and shown, never dropped. */
  queued: ProposedGroup[];
  /**
   * The items behind those queued PRs.
   *
   * Returned so the caller can KEEP them: they were never sent, so clearing the
   * whole session on success would destroy exactly the reports the reporter was
   * just told stayed queued.
   */
  queuedItems: DebugItem[];
  /** Captures that could not be read back out of the store. */
  missingCaptures: string[];
};

/**
 * The groups a handover would actually send, before the session cap.
 *
 * SHARED with `handoverSummary` on purpose: the preview and the action have to
 * agree about which groups are alive, and two copies of this filter are how they
 * stopped agreeing.
 */
export function liveGroups(
  items: readonly DebugItem[],
  groups: readonly ProposedGroup[],
): ProposedGroup[] {
  const keptIds = new Set(
    items.filter((item) => item.disposition !== "discard").map((item) => item.id),
  );
  return groups
    .map((group) => ({ ...group, itemIds: group.itemIds.filter((id) => keptIds.has(id)) }))
    .filter((group) => group.itemIds.length > 0);
}

/**
 * Send the confirmed batch.
 *
 * The captures travel as data URLs read back out of the store, and one that
 * cannot be read is REPORTED rather than skipped — the reporter approved a
 * bundle including that image, so its absence is something they are owed.
 */
export async function handOver(options: {
  host: Pick<HostAdapter, "send" | "environment">;
  store: Pick<CaptureStore, "getCapture">;
  sessionId: string;
  items: readonly DebugItem[];
  groups: readonly ProposedGroup[];
  drafts: Map<string, Draft>;
  now?: () => number;
}): Promise<HandoverResult> {
  const kept = options.items.filter((item) => item.disposition !== "discard");

  // The cap is applied AFTER dead groups are removed. Applied before, a group
  // whose items the reporter had all dropped still consumed one of the five
  // slots, so the batch under-delivered while a real PR was reported as queued.
  const alive = liveGroups(options.items, options.groups);
  const { send, queued } = withinSessionCap(alive);

  // ONLY the items behind the PRs being sent travel. Sending the rest would put
  // them in front of the pipeline ungrouped, which could open a PR for each and
  // defeat the cap they were held back by.
  //
  // With NO grouping at all, everything travels: a caller that supplies none has
  // not held anything back, and silently sending nothing would be the worst
  // possible reading of an empty list.
  const grouped = alive.length > 0;
  const sending = new Set(send.flatMap((group) => group.itemIds));
  const queuedItems = grouped
    ? kept.filter((item) => !sending.has(item.id))
    : [];

  const items = kept
    .filter((item) => !grouped || sending.has(item.id))
    .map((item) => {
      const draft = options.drafts.get(item.id);
      return draft ? { ...item, draft } : item;
    });

  const bundle = buildBundle({
    sessionId: options.sessionId,
    items,
    env: options.host.environment(),
    groups: send,
    ...(options.now ? { now: options.now } : {}),
  });

  // Read in parallel: N captures were N sequential IndexedDB round-trips.
  const reads = await Promise.all(
    bundle.items.map(async (item) =>
      item.capture
        ? {
            note: item.note,
            id: item.capture.id,
            dataUrl: await options.store.getCapture(item.capture.id),
          }
        : undefined,
    ),
  );
  const captures: Array<{ id: string; dataUrl: string }> = [];
  const missingCaptures: string[] = [];
  for (const read of reads) {
    if (!read) continue;
    if (read.dataUrl) captures.push({ id: read.id, dataUrl: read.dataUrl });
    else missingCaptures.push(read.note);
  }

  const sent = await options.host.send(bundle, captures);
  return { sent, bundle, queued, queuedItems, missingCaptures };
}

/** One line the panel shows above the button. */
export function handoverSummary(
  items: readonly DebugItem[],
  groups: readonly ProposedGroup[],
): string {
  const summary = summariseBundle(items, groups);
  // THE SAME GROUPS `handOver` WILL SEND. The cap was applied to the raw
  // proposal, so a group naming only discarded items counted against it here and
  // not there — the panel could say a PR was waiting for the next batch while
  // the handover sent it. A preview that disagrees with the action is the one
  // thing this panel may not do.
  const alive = liveGroups(items, groups);
  const { queued } = withinSessionCap(alive);
  const parts = [
    `${summary.items} report${summary.items === 1 ? "" : "s"}`,
    `${summary.groups} PR${summary.groups === 1 ? "" : "s"}`,
  ];
  if (summary.captures > 0) parts.push(`${summary.captures} image(s)`);
  if (summary.discarded > 0) parts.push(`${summary.discarded} dropped`);
  if (queued.length > 0) parts.push(`${queued.length} waiting for the next batch`);
  return parts.join(" · ");
}

/**
 * What the reporter is told after the handover.
 *
 * The round trip is not decoration: without it the habit does not form, and the
 * caps and adjustments this feature applies would be invisible.
 */
export function handoverReport(result: HandoverResult): string {
  if (!result.sent.ok) return `Nothing was sent — ${result.sent.error}`;
  const lines = [`Sent ${result.bundle.items.length} report(s) to ${result.sent.ref}.`];
  if (result.bundle.groups) {
    lines.push(
      `Proposed ${result.bundle.groups.length} PR(s); the pipeline may split or merge them and will say why.`,
    );
  }
  if (result.queued.length > 0) {
    lines.push(
      `${result.queued.length} PR(s) stayed queued to keep one session from filling CI.`,
    );
  }
  if (result.missingCaptures.length > 0) {
    lines.push(
      `Sent without an image: ${result.missingCaptures.map((n) => `“${n}”`).join(", ")}.`,
    );
  }
  return lines.join(" ");
}
