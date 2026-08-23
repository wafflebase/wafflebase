// Turn an intake plan into the PRs it becomes — and say, out loud, how the
// result differs from the shape the reporter approved.
//
// **THE DELTA IS THE POINT OF THIS FILE.** A grouping proposal is made in a
// browser, which cannot know which files an item touches, so the repository side
// has to adjust it: two items that turn out to share a file MUST be one PR
// (separate ones would conflict), and an item whose kind was misjudged, or a
// group over the size cap, must come apart. Neither adjustment is the problem.
// The problem is a SILENT adjustment — a PR shaped differently from what the
// person approved, with no stated reason, breaks trust before it breaks anything
// else. So every change is recorded with the reason, and the round trip carries
// it back (`docs/design/debug-report.md`, *The proposal is not a contract*).
//
// Splitting is always safe; merging across kinds is not, and this never does it.
//
// Usage:
//   node report-to-pr.mjs --plan plan.json [--touches touches.json]
//        [--verified verified.json] [--dry-run]
//
// `--verified` carries the replay outcomes. An item whose replay failed becomes
// an issue holding both sides rather than a PR — without this flag nothing is
// lowered, and a refuted report would open its PR anyway.
//
// `--touches` maps an item id to the files a change for it would touch. Absent,
// nothing is force-merged and the plan says so — an unknown is reported, not
// assumed.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DISCLOSURE_TRAILER } from "./disclosure.mjs";

/** At most this many items in one PR. */
export const MAX_GROUP_ITEMS = 8;

// THERE IS NO LINE CAP HERE. `MAX_GROUP_LINES = 300` sat in this file, declared
// and documented and read by nothing: `--touches` carries file paths, never line
// counts, so this script cannot know how large a change is before it is written.
// A dead constant made the operator doc's "300 lines per PR" read as enforced,
// and a 1,200-line PR would have been disclosed as within the caps. The line
// budget belongs to whoever writes the change; the doc now says so.

/** At most this many PRs from one session. The rest stay queued and visible. */
export const MAX_SESSION_PRS = 5;

/** Kinds that may share a PR with their own kind. */
export const GROUPABLE_KINDS = ["spacing", "color", "token", "copy", "a11y", "affordance"];

/** Kinds that never share a PR, whatever the proposal said. */
export const SOLO_KINDS = ["logic", "layout"];

const kindOf = (item) => item.draft?.kind ?? "logic";

/**
 * Assemble the PRs.
 *
 * Returns `{ prs, queued, deltas }`. A `delta` is `{ kind, reason, ... }` and is
 * the record a person reads to understand why what they approved is not exactly
 * what appeared.
 */
export function assemblePrs(
  plan,
  { touches = null, verified = null, maxSessionPrs = MAX_SESSION_PRS } = {},
) {
  const deltas = [];
  const byId = new Map(plan.items.map((item) => [item.id, item]));

  // A REPLAY THAT FAILED LOWERS THE DESTINATION, and this is where that takes
  // effect. Assembly consumed only the intake plan, so `applyReplayOutcome` was
  // reachable from nothing but its own test: a refuted item opened its PR AND
  // was counted as an issue by `report-back.mjs`, appearing in both buckets
  // while the header promised the lowering was implemented.
  const lowered = new Map(
    (verified?.outcomes ?? [])
      .filter((outcome) => outcome.verified === false)
      .map((outcome) => [outcome.itemId, outcome]),
  );

  // Only items headed for a PR are assembled. A duplicate becomes a comment and
  // a thin report becomes an issue; putting either in a branch would file a
  // change nobody asked for.
  const forPr = plan.items.filter(
    (item) =>
      !lowered.has(item.id) &&
      (item.route.destination === "verify" || item.route.destination === "appearance"),
  );
  for (const [itemId, outcome] of lowered) {
    if (!byId.has(itemId)) continue;
    deltas.push({
      kind: "lowered",
      itemId,
      // The report is NOT dropped: it becomes an issue carrying the reporter's
      // expectation and the failed replay, for a person to resolve.
      reason: `“${byId.get(itemId).note}” did not verify, so it is an issue carrying both sides rather than a PR — ${outcome.note}`,
    });
  }
  const forPrIds = new Set(forPr.map((item) => item.id));

  // 1. Start from the approved shape, keeping only the items that reach a PR.
  let groups = (plan.groups ?? [])
    .map((group) => ({
      id: group.id,
      kind: group.kind,
      itemIds: group.itemIds.filter((id) => forPrIds.has(id)),
      prTitle: group.prTitle,
    }))
    .filter((group) => group.itemIds.length > 0);

  // Items the proposal never placed — or placed into a group that lost them —
  // each become their own PR rather than being dropped.
  const placed = new Set(groups.flatMap((g) => g.itemIds));
  for (const item of forPr) {
    if (placed.has(item.id)) continue;
    groups.push({
      id: `solo-${item.id}`,
      kind: kindOf(item),
      itemIds: [item.id],
      prTitle: item.draft?.title ?? item.note.slice(0, 70),
    });
  }

  // 2. FORCED SPLIT — a kind that never shares a PR leaves the group it was
  // proposed into. Its blast radius (layout) or its independence (logic) is the
  // reason, and both are decided per item, not per proposal.
  groups = groups.flatMap((group) => {
    const solo = group.itemIds.filter((id) => SOLO_KINDS.includes(kindOf(byId.get(id))));
    if (solo.length === 0 || group.itemIds.length === 1) return [group];
    const rest = group.itemIds.filter((id) => !solo.includes(id));
    for (const id of solo) {
      deltas.push({
        kind: "split",
        itemId: id,
        from: group.id,
        reason: `a ${kindOf(byId.get(id))} change is kept on its own so one blocked review cannot hold up the rest`,
      });
    }
    const out = solo.map((id) => ({
      id: `solo-${id}`,
      kind: kindOf(byId.get(id)),
      itemIds: [id],
      prTitle: byId.get(id).draft?.title ?? byId.get(id).note.slice(0, 70),
    }));
    return rest.length > 0 ? [{ ...group, itemIds: rest }, ...out] : out;
  });

  // 3. FORCED MERGE — items touching the same file must be one PR, or the PRs
  // conflict with each other. This is the half the browser could not compute.
  if (touches) {
    groups = forceMergeByFile(groups, touches, deltas, byId);
  } else {
    deltas.push({
      kind: "unknown",
      reason:
        "no file map was supplied, so file overlap was not checked; two PRs here may still turn out to touch one file",
    });
  }

  // 4. The item cap — LAST, and it does not touch a group the files forced.
  // Splitting a force-merged group re-creates the exact conflict step 3 exists
  // to prevent: nine items all touching `src/toolbar.tsx` became two PRs both
  // touching `src/toolbar.tsx`, reported as a routine size split. Between "the
  // PR is larger than the cap" and "two PRs conflict", the cap is the one that
  // can be exceeded and merely disclosed.
  groups = groups.flatMap((group) => {
    if (group.itemIds.length <= MAX_GROUP_ITEMS) return [group];
    if (group.fileForced) {
      deltas.push({
        kind: "over-cap",
        from: group.id,
        prIds: [group.id],
        reason: `${group.itemIds.length} items is over the ${MAX_GROUP_ITEMS}-item limit, but they share files — splitting them would produce PRs that conflict, so this one is larger instead`,
      });
      return [group];
    }
    const chunks = [];
    for (let i = 0; i < group.itemIds.length; i += MAX_GROUP_ITEMS) {
      chunks.push(group.itemIds.slice(i, i + MAX_GROUP_ITEMS));
    }
    const ids = chunks.map((_, i) => `${group.id}-${i + 1}`);
    deltas.push({
      kind: "split",
      from: group.id,
      // THE RESULTING IDS, not only the old one. `renderPrBody` matches a delta
      // against `pr.id`, and the split renamed every group it produced — so the
      // one adjustment guaranteed to surprise the reporter appeared in no PR
      // body at all, in the file whose header calls the delta its whole point.
      prIds: ids,
      reason: `${group.itemIds.length} items exceeds the ${MAX_GROUP_ITEMS}-item limit, so it was split into ${chunks.length}`,
    });
    return chunks.map((itemIds, i) => ({ ...group, id: ids[i], itemIds }));
  });

  const prs = groups.slice(0, maxSessionPrs).map((group) => toPr(group, byId));
  const queued = groups.slice(maxSessionPrs).map((group) => toPr(group, byId));
  if (queued.length > 0) {
    deltas.push({
      kind: "queued",
      reason: `${queued.length} PR(s) stayed queued: one session may open at most ${maxSessionPrs}, so a batch cannot fill CI`,
    });
  }

  return { prs, queued, deltas };
}

/**
 * Merge the groups whose items share a file.
 *
 * Transitive: if A and B share one file and B and C share another, all three
 * become one PR, because any split among them conflicts somewhere.
 */
function forceMergeByFile(groups, touches, deltas, byId) {
  // A group holding a kind that never shares a PR is not a merge candidate.
  // Unioning it anyway relabelled the result `mixed` and shipped a `logic` fix
  // alongside a spacing tweak — the thing `SOLO_KINDS` exists to forbid — and
  // emitted a split and a merge for the same pair, which reads as contradictory.
  // Both rules cannot hold at once here, so the stronger one (an independent
  // review for a behaviour change) wins and the conflict is REPORTED instead.
  const isSolo = (group) => group.itemIds.some((id) => SOLO_KINDS.includes(kindOf(byId.get(id))));
  const fileOwners = new Map();
  for (const group of groups) {
    for (const id of group.itemIds) {
      for (const file of touches[id] ?? []) {
        if (!fileOwners.has(file)) fileOwners.set(file, new Set());
        fileOwners.get(file).add(group.id);
      }
    }
  }

  const parent = new Map(groups.map((g) => [g.id, g.id]));
  const find = (id) => (parent.get(id) === id ? id : find(parent.get(id)));
  const byGroupId = new Map(groups.map((g) => [g.id, g]));
  const union = (a, b, file) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const solo = [ra, rb].filter((id) => isSolo(byGroupId.get(id)));
    if (solo.length > 0) {
      deltas.push({
        kind: "conflict",
        groups: [ra, rb],
        prIds: [ra, rb],
        file,
        reason: `${ra} and ${rb} both touch ${file}, but ${solo.join(" and ")} must stay on its own — land one first, then rebase the other`,
      });
      return;
    }
    parent.set(rb, ra);
    deltas.push({
      kind: "merge",
      groups: [ra, rb],
      prIds: [ra],
      file,
      reason: `both touch ${file}; kept as one PR because separate ones would conflict`,
    });
  };

  for (const [file, owners] of fileOwners) {
    const list = [...owners];
    for (let i = 1; i < list.length; i += 1) union(list[0], list[i], file);
  }

  const merged = new Map();
  for (const group of groups) {
    const root = find(group.id);
    const existing = merged.get(root);
    if (!existing) {
      merged.set(root, { ...group, id: root });
      continue;
    }
    existing.itemIds = [...existing.itemIds, ...group.itemIds];
    // Marked so the item cap cannot split it back into conflicting PRs.
    existing.fileForced = true;
    // A merge across kinds happens only because the FILES forced it, and the
    // resulting PR is labelled `mixed` rather than claiming to be one kind. A
    // wrong label is what a downstream router would act on.
    if (existing.kind !== group.kind) existing.kind = "mixed";
  }
  return [...merged.values()];
}

/**
 * One PR: a branch, a title, a body, and one commit per item.
 *
 * ONE ITEM IS ONE COMMIT so a reviewer can drop a single commit to reject a
 * single report — and the reporter's own sentence is the commit body's *why*,
 * which is what the repository's commit convention asks for.
 */
function toPr(group, byId) {
  const items = group.itemIds.map((id) => byId.get(id)).filter(Boolean);
  return {
    id: group.id,
    kind: group.kind,
    branch: `report/${group.id}`,
    // Falls back rather than throwing. `parseBundle` requires `prTitle`, but the
    // pipeline's own `validateBundle` did not, so a bundle from any non-browser
    // producer reached here and died on `undefined.slice`. Both validators now
    // require it; this stays as the belt to that braces.
    title: String(group.prTitle ?? items[0]?.draft?.title ?? items[0]?.note ?? group.id).slice(0, 70),
    itemIds: group.itemIds,
    commits: items.map((item) => ({
      itemId: item.id,
      subject: (item.draft?.title ?? item.note).slice(0, 70),
      body: commitBody(item),
    })),
    lens: items.some((item) => item.route.lens === "visual-intent") ? "visual-intent" : null,
    agentCandidate: items.some((item) => item.agentCandidate),
  };
}

function commitBody(item) {
  const lines = [];
  // The reporter's words, verbatim and attributed. An agent's paraphrase in this
  // slot would make the record of what was observed unrecoverable.
  lines.push(`Reported from the running app: ${JSON.stringify(item.note)}`);
  if (item.draft?.body) lines.push("", item.draft.body);
  const where =
    item.target?.address ??
    item.target?.selector ??
    (item.target?.kind === "viewport" ? "a region of the screen" : item.target?.kind);
  if (where) lines.push("", `Aimed at: ${where}`);
  lines.push("", DISCLOSURE_TRAILER);
  return lines.join("\n");
}

/**
 * The PR body.
 *
 * Carries the reporter's sentence and the delta, and — for an appearance
 * report — states which lens judges it, so a reviewer knows the claim being
 * checked is "does this satisfy what the reporter said".
 */
export function renderPrBody(pr, plan, deltas) {
  const items = pr.itemIds.map((id) => plan.items.find((i) => i.id === id)).filter(Boolean);
  const lines = ["## Reported from the running app", ""];
  for (const item of items) {
    lines.push(`- ${item.note}`);
    if (item.target?.address) lines.push(`  - at \`${item.target.address}\``);
    if (item.route.lens) lines.push(`  - judged by the \`${item.route.lens}\` lens`);
  }
  lines.push("", `Build: ${plan.buildSha ?? "unknown"} · route: ${plan.route ?? "unknown"}`);

  const mine = deltas.filter(
    (d) =>
      (d.prIds ?? []).includes(pr.id) ||
      d.from === pr.id ||
      (d.groups ?? []).includes(pr.id) ||
      d.kind === "unknown",
  );
  if (mine.length > 0) {
    lines.push("", "## How this differs from the approved shape", "");
    for (const delta of mine) lines.push(`- ${delta.reason}`);
  }

  lines.push(
    "",
    "The reporter approved a *shape*, not a promise about the number of PRs.",
    "",
    DISCLOSURE_TRAILER,
  );
  return lines.join("\n");
}

/** What the reporter is told, and what `report-back.mjs` writes into the bundle. */
export function renderDelta(plan, { prs, queued, deltas }) {
  const proposed = (plan.groups ?? []).length;
  const parts = [
    `sent ${plan.items.length} · proposed ${proposed} PR(s) → actual ${prs.length}`,
  ];
  const issues = plan.items.filter((i) => i.route.destination === "thin").length;
  const dupes = plan.items.filter((i) => i.route.destination === "duplicate").length;
  if (issues > 0) parts.push(`${issues} issue(s) asking for more`);
  if (dupes > 0) parts.push(`${dupes} comment(s) on existing reports`);
  if (queued.length > 0) parts.push(`${queued.length} queued`);
  const lines = [parts.join(" · ")];
  for (const delta of deltas) lines.push(`  - ${delta.reason}`);
  return lines.join("\n");
}

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
  const planFile = argOf(argv, "--plan");
  if (!planFile) {
    process.stderr.write(
      "usage: report-to-pr.mjs --plan <file> [--touches <file>] [--verified <file>] [--dry-run]\n",
    );
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const touchesFile = argOf(argv, "--touches");
  const touches = touchesFile ? JSON.parse(readFileSync(touchesFile, "utf8")) : null;
  const verifiedFile = argOf(argv, "--verified");
  const verified = verifiedFile ? JSON.parse(readFileSync(verifiedFile, "utf8")) : null;
  const assembled = assemblePrs(plan, { touches, verified });

  process.stdout.write(`${renderDelta(plan, assembled)}\n\n`);
  for (const pr of assembled.prs) {
    // Size is disclosed BEFORE anything is opened, which is the repository's own
    // rule for agent-authored pull requests.
    process.stdout.write(
      `${pr.branch}  ${pr.commits.length} commit(s)  ${pr.kind}${pr.lens ? `  lens:${pr.lens}` : ""}\n  ${pr.title}\n`,
    );
  }

  const out = argOf(argv, "--out");
  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify({ ...assembled, bodies: assembled.prs.map((pr) => renderPrBody(pr, plan, assembled.deltas)) }, null, 2)}\n`,
    );
  }
  // NOTHING IS OPENED HERE. Handing the assembly to `spec-to-pr.mjs handoff` is
  // a separate, explicit step: this script exists to be read before that.
  if (!argv.includes("--dry-run")) {
    process.stdout.write(
      "\nnothing was opened — pass this to `spec-to-pr.mjs handoff`, which is where a PR is created\n",
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
