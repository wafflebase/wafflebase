// The delta is the point of this module, so most of these tests assert that an
// adjustment HAPPENED and that it was REPORTED — a silent adjustment is the
// failure this file exists to prevent.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assemblePrs,
  MAX_GROUP_ITEMS,
  MAX_SESSION_PRS,
  renderDelta,
  renderPrBody,
} from "./report-to-pr.mjs";
import { DISCLOSURE_TRAILER } from "./disclosure.mjs";

const item = (id, kind = "spacing", over = {}) => ({
  id,
  note: `report ${id} about something specific`,
  target: { kind: "dom", selector: `div > button.${id}`, tag: "button" },
  disposition: "verify",
  agentCandidate: false,
  draft: { title: `Fix ${id}`, body: `Body for ${id}`, kind, severity: "minor", labels: [] },
  route: { destination: kind === "logic" ? "verify" : "appearance", lens: "visual-intent" },
  ...over,
});

const plan = (items, groups = []) => ({
  sessionId: "s1",
  buildSha: "abc1234",
  route: "/s/:id",
  items,
  groups,
  counts: {},
  missingCaptures: [],
  filed: false,
});

test("the approved shape is the starting point", () => {
  const p = plan(
    [item("a"), item("b")],
    [{ id: "g1", kind: "spacing", itemIds: ["a", "b"], prTitle: "Room to breathe" }],
  );
  const { prs } = assemblePrs(p, { touches: {} });
  assert.equal(prs.length, 1);
  assert.deepEqual(prs[0].itemIds, ["a", "b"]);
  assert.equal(prs[0].title, "Room to breathe");
});

test("an item the proposal never placed becomes its own PR rather than vanishing", () => {
  const { prs } = assemblePrs(plan([item("a"), item("b")], []), { touches: {} });
  assert.equal(prs.length, 2);
});

test("only items headed for a PR are assembled", () => {
  // A duplicate becomes a comment and a thin report becomes an issue; putting
  // either in a branch would file a change nobody asked for.
  const p = plan([
    item("a"),
    item("b", "spacing", { route: { destination: "duplicate", duplicateOf: "#1" } }),
    item("c", "spacing", { route: { destination: "thin" } }),
  ]);
  const { prs } = assemblePrs(p, { touches: {} });
  assert.deepEqual(prs.flatMap((pr) => pr.itemIds), ["a"]);
});

test("FORCED SPLIT: a logic item leaves the group it was proposed into, with a reason", () => {
  const p = plan(
    [item("a"), item("b", "logic")],
    [{ id: "g1", kind: "spacing", itemIds: ["a", "b"], prTitle: "Mixed" }],
  );
  const { prs, deltas } = assemblePrs(p, { touches: {} });
  assert.equal(prs.length, 2);
  const split = deltas.find((d) => d.kind === "split" && d.itemId === "b");
  assert.ok(split, "the split must be recorded");
  assert.match(split.reason, /one blocked review cannot hold up the rest/);
});

test("FORCED SPLIT applies to layout too, whose blast radius differs per file", () => {
  const p = plan(
    [item("a"), item("b", "layout")],
    [{ id: "g1", kind: "spacing", itemIds: ["a", "b"], prTitle: "Mixed" }],
  );
  const { prs, deltas } = assemblePrs(p, { touches: {} });
  assert.equal(prs.length, 2);
  assert.ok(deltas.some((d) => d.kind === "split" && d.itemId === "b"));
});

test("FORCED MERGE: two PRs touching one file become one, and the file is named", () => {
  const p = plan(
    [item("a"), item("b")],
    [
      { id: "g1", kind: "spacing", itemIds: ["a"], prTitle: "A" },
      { id: "g2", kind: "spacing", itemIds: ["b"], prTitle: "B" },
    ],
  );
  const { prs, deltas } = assemblePrs(p, {
    touches: { a: ["src/toolbar.tsx"], b: ["src/toolbar.tsx"] },
  });
  assert.equal(prs.length, 1, "separate PRs touching one file would conflict");
  const merge = deltas.find((d) => d.kind === "merge");
  assert.ok(merge);
  assert.equal(merge.file, "src/toolbar.tsx");
  assert.match(merge.reason, /separate ones would conflict/);
});

test("a forced merge is transitive, because any split among them conflicts somewhere", () => {
  const p = plan(
    [item("a"), item("b"), item("c")],
    [
      { id: "g1", kind: "spacing", itemIds: ["a"], prTitle: "A" },
      { id: "g2", kind: "spacing", itemIds: ["b"], prTitle: "B" },
      { id: "g3", kind: "spacing", itemIds: ["c"], prTitle: "C" },
    ],
  );
  const { prs } = assemblePrs(p, {
    touches: { a: ["x.ts"], b: ["x.ts", "y.ts"], c: ["y.ts"] },
  });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].itemIds.length, 3);
});

test("a merge the FILES forced across kinds is labelled mixed, not mislabelled", () => {
  // A wrong kind is what a downstream router would act on.
  const p = plan(
    [item("a", "spacing"), item("b", "copy")],
    [
      { id: "g1", kind: "spacing", itemIds: ["a"], prTitle: "A" },
      { id: "g2", kind: "copy", itemIds: ["b"], prTitle: "B" },
    ],
  );
  const { prs } = assemblePrs(p, { touches: { a: ["z.ts"], b: ["z.ts"] } });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].kind, "mixed");
});

test("with no file map, the unknown is REPORTED rather than assumed away", () => {
  const { deltas } = assemblePrs(plan([item("a")]), {});
  const unknown = deltas.find((d) => d.kind === "unknown");
  assert.ok(unknown);
  assert.match(unknown.reason, /file overlap was not checked/);
});

test("a group past the item cap is split, and the split is reported", () => {
  const ids = Array.from({ length: MAX_GROUP_ITEMS + 3 }, (_, i) => `i${i}`);
  const p = plan(
    ids.map((id) => item(id)),
    [{ id: "g1", kind: "spacing", itemIds: ids, prTitle: "Everything" }],
  );
  const { prs, deltas } = assemblePrs(p, { touches: {} });
  assert.equal(prs.length, 2);
  assert.ok(prs.every((pr) => pr.itemIds.length <= MAX_GROUP_ITEMS));
  assert.ok(deltas.some((d) => d.reason.includes(`${MAX_GROUP_ITEMS}-item limit`)));
});

test("the per-session cap queues the rest, and says so", () => {
  const ids = Array.from({ length: MAX_SESSION_PRS + 2 }, (_, i) => `q${i}`);
  const p = plan(
    ids.map((id) => item(id)),
    ids.map((id) => ({ id: `g-${id}`, kind: "spacing", itemIds: [id], prTitle: id })),
  );
  const { prs, queued, deltas } = assemblePrs(p, { touches: {} });
  assert.equal(prs.length, MAX_SESSION_PRS);
  assert.equal(queued.length, 2);
  assert.ok(deltas.some((d) => d.kind === "queued"));
});

test("one item is one commit, and the reporter's sentence is the commit's why", () => {
  // A reviewer can drop a single commit to reject a single report; an agent's
  // paraphrase in that slot would make the record unrecoverable.
  const p = plan(
    [item("a"), item("b")],
    [{ id: "g1", kind: "spacing", itemIds: ["a", "b"], prTitle: "Both" }],
  );
  const { prs } = assemblePrs(p, { touches: {} });
  assert.equal(prs[0].commits.length, 2);
  assert.match(prs[0].commits[0].body, /Reported from the running app: "report a about something specific"/);
  // Compared as text: the trailer contains parentheses, which a bare RegExp
  // would read as a group.
  assert.ok(prs[0].commits[0].body.includes(DISCLOSURE_TRAILER));
});

test("a PR carrying an appearance report names the lens that judges it", () => {
  const { prs } = assemblePrs(plan([item("a")]), { touches: {} });
  assert.equal(prs[0].lens, "visual-intent");
});

test("the PR body carries the sentence, the build, and the delta", () => {
  const p = plan(
    [item("a"), item("b", "logic")],
    [{ id: "g1", kind: "spacing", itemIds: ["a", "b"], prTitle: "Mixed" }],
  );
  const assembled = assemblePrs(p, { touches: {} });
  const body = renderPrBody(assembled.prs[0], p, assembled.deltas);
  assert.match(body, /Reported from the running app/);
  assert.match(body, /abc1234/);
  assert.match(body, /How this differs from the approved shape/);
  assert.match(body, /approved a \*shape\*/);
});

test("renderDelta states proposed versus actual, and every reason", () => {
  const p = plan(
    [
      item("a"),
      item("b", "logic"),
      item("c", "spacing", { route: { destination: "duplicate", duplicateOf: "#3" } }),
      item("d", "spacing", { route: { destination: "thin" } }),
    ],
    [{ id: "g1", kind: "spacing", itemIds: ["a", "b"], prTitle: "Mixed" }],
  );
  const assembled = assemblePrs(p, { touches: {} });
  const text = renderDelta(p, assembled);
  assert.match(text, /proposed 1 PR\(s\) → actual 2/);
  assert.match(text, /1 issue\(s\) asking for more/);
  assert.match(text, /1 comment\(s\) on existing reports/);
  assert.match(text, /one blocked review cannot hold up the rest/);
});

test("nothing in this module opens anything", async () => {
  // The assembly is data. Opening a PR is `spec-to-pr.mjs handoff`, a separate
  // and explicit step — this module exists to be read before that.
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./report-to-pr.mjs", import.meta.url), "utf8"),
  );
  assert.ok(!/execFileSync|spawnSync|\bgh\b\s*\(/.test(source), "no process is spawned here");
});

// --- regressions from the PR ④ review ---------------------------------------

const forPr = (id, kind) => ({
  id,
  note: `note ${id}`,
  draft: { kind, title: `title ${id}` },
  route: { destination: "appearance" },
});

test("file overlap never merges a solo kind into a shared PR", () => {
  // The merge ran after the split and undid it: a `logic` item was unioned back
  // into the spacing group, the result relabelled `mixed`, and the delta list
  // carried a split and a merge for the same pair.
  const plan = {
    sessionId: "s",
    items: [forPr("a", "spacing"), forPr("b", "logic")],
    groups: [{ id: "g1", kind: "spacing", itemIds: ["a", "b"], prTitle: "both" }],
  };
  const { prs, deltas } = assemblePrs(plan, {
    touches: { a: ["src/toolbar.tsx"], b: ["src/toolbar.tsx"] },
  });
  assert.equal(prs.length, 2, "the logic item must keep its own PR");
  assert.ok(!prs.some((pr) => pr.kind === "mixed"), "nothing may be relabelled mixed here");
  assert.ok(!deltas.some((d) => d.kind === "merge"), "a solo kind is not a merge candidate");
  // The overlap is real and must still be reported — silence would produce two
  // PRs that conflict with no warning.
  const conflict = deltas.find((d) => d.kind === "conflict");
  assert.ok(conflict, "the file overlap must be disclosed");
  assert.match(conflict.reason, /src\/toolbar\.tsx/);
  assert.match(conflict.reason, /land one first/);
});

test("the item cap does not split a group the files forced together", () => {
  const items = Array.from({ length: 9 }, (_, i) => forPr(`i${i}`, "spacing"));
  const plan = {
    sessionId: "s",
    items,
    groups: items.map((item, i) => ({
      id: `g${i}`,
      kind: "spacing",
      itemIds: [item.id],
      prTitle: "t",
    })),
  };
  const { prs, deltas } = assemblePrs(plan, {
    touches: Object.fromEntries(items.map((item) => [item.id, ["src/toolbar.tsx"]])),
  });
  // Splitting here would produce two PRs both touching `src/toolbar.tsx` —
  // exactly the conflict the merge exists to prevent, reported as a size split.
  assert.equal(prs.length, 1);
  assert.equal(prs[0].itemIds.length, 9);
  const over = deltas.find((d) => d.kind === "over-cap");
  assert.ok(over, "going over the cap must be disclosed, not silent");
  assert.match(over.reason, /would produce PRs that conflict/);
});

test("a cap split is disclosed in the body of every PR it produced", () => {
  // The split renamed its groups after recording the delta against the old id,
  // so `renderPrBody` matched nothing and the adjustment appeared nowhere.
  const items = Array.from({ length: 9 }, (_, i) => forPr(`i${i}`, "spacing"));
  const plan = {
    sessionId: "s",
    items,
    groups: [{ id: "g1", kind: "spacing", itemIds: items.map((i) => i.id), prTitle: "nine" }],
  };
  const { prs, deltas } = assemblePrs(plan, {
    touches: Object.fromEntries(items.map((item, i) => [item.id, [`src/f${i}.tsx`]])),
  });
  assert.equal(prs.length, 2);
  for (const pr of prs) {
    const body = renderPrBody(pr, plan, deltas);
    assert.match(body, /How this differs from the approved shape/, `${pr.id} hid the split`);
    assert.match(body, /exceeds the 8-item limit/, `${pr.id} did not say why`);
  }
});

test("a group with no prTitle still assembles", () => {
  // Both validators now require it, so this is unreachable through them — but a
  // crash on `undefined.slice` is not how a missing field should present.
  const plan = {
    sessionId: "s",
    items: [forPr("a", "spacing")],
    groups: [{ id: "g1", kind: "spacing", itemIds: ["a"] }],
  };
  assert.equal(assemblePrs(plan, {}).prs[0].title, "title a");
});

test("a report whose replay failed becomes an issue, not a PR", () => {
  // Assembly consumed only the intake plan, so a refuted item opened its PR AND
  // was counted as an issue by report-back — in both buckets at once, while the
  // header promised the lowering was implemented.
  const plan = {
    sessionId: "s",
    items: [
      { ...forPr("a", "spacing"), route: { destination: "verify" } },
      { ...forPr("b", "spacing"), route: { destination: "verify" } },
    ],
    groups: [],
  };
  const verified = {
    outcomes: [{ itemId: "b", verified: false, note: "replay did not reproduce it" }],
  };
  const { prs, deltas } = assemblePrs(plan, { verified });
  assert.deepEqual(prs.flatMap((pr) => pr.itemIds), ["a"]);
  const lowered = deltas.find((d) => d.kind === "lowered");
  assert.ok(lowered, "the lowering must be disclosed");
  // The report is not dropped — both sides travel.
  assert.match(lowered.reason, /issue carrying both sides/);
});
