// Routing decides what happens to a person's report, so the tests are about the
// DECISIONS rather than the shape of the object carrying them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DUPLICATE_OVERLAP,
  findDuplicate,
  looksReplayable,
  planIntake,
  redactItem,
  renderPlan,
  reportKey,
  routeItem,
} from "./report-intake.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bundle = () =>
  JSON.parse(
    readFileSync(path.join(HERE, "fixtures", "debug-report", "bundle-valid.json"), "utf8"),
  );

const item = (over = {}) => ({
  id: "i1",
  note: "the toolbar icons are cramped",
  target: { kind: "dom", selector: "div.toolbar > button", tag: "button" },
  disposition: "verify",
  agentCandidate: false,
  ...over,
});

test("looksReplayable reads for a described sequence, not for a feeling", () => {
  assert.equal(looksReplayable("after I merge two cells, undo goes one step short"), true);
  assert.equal(looksReplayable("clicked Bold and nothing happened"), true);
  assert.equal(looksReplayable("the toolbar icons are cramped"), false);
  assert.equal(looksReplayable(""), false);
});

test("a report with steps goes to verify", () => {
  const route = routeItem(item({ note: "after I merge cells, undo goes one step short" }));
  assert.equal(route.destination, "verify");
});

test("an appearance kind skips replay but NOT review", () => {
  const route = routeItem(
    item({ draft: { title: "Give the toolbar room", kind: "spacing" } }),
  );
  assert.equal(route.destination, "appearance");
  assert.equal(route.lens, "visual-intent");
  assert.match(route.reason, /no prediction to replay/);
});

test("a report with no steps at all is still reviewed, not dropped", () => {
  const route = routeItem(item({ note: "this whole panel looks wrong somehow" }));
  assert.equal(route.destination, "appearance");
  assert.equal(route.lens, "visual-intent");
});

test("the reporter's own disposition outranks the heuristics", () => {
  // `publish` means "file it, do not replay it". Second-guessing that would make
  // their choice decorative.
  const route = routeItem(
    item({ disposition: "publish", note: "after I click Bold the sheet scrolls" }),
  );
  assert.equal(route.destination, "appearance");
  assert.match(route.reason, /the reporter asked/);
});

test("a sentence too short to act on is filed asking for more, never dropped", () => {
  const route = routeItem(item({ note: "broken" }));
  assert.equal(route.destination, "thin");
  assert.match(route.reason, /too short/);
});

test("an appearance report with no image on disk says so in the plan", () => {
  const route = routeItem(
    item({ draft: { title: "t", kind: "color" } }),
    { capturePresent: false },
  );
  assert.match(route.warning, /no image on disk/);
});

test("a duplicate goes to a comment on what already exists", () => {
  const prior = [
    { key: reportKey(item()), text: "the toolbar icons are cramped", ref: "#123" },
  ];
  const route = routeItem(item(), { prior });
  assert.equal(route.destination, "duplicate");
  assert.equal(route.duplicateOf, "#123");
});

test("findDuplicate also catches a re-wording, by overlap", () => {
  const prior = [
    {
      key: "elsewhere::something else",
      text: "the toolbar icons are cramped together with no gap",
      ref: "#7",
    },
  ];
  const found = findDuplicate(item({ note: "the toolbar icons are cramped with no gap" }), prior);
  assert.ok(found, "a re-wording of the same report should match");
  assert.equal(found.match.ref, "#7");
  assert.match(found.why, /overlap/);
});

test("findDuplicate leaves an unrelated report alone", () => {
  const prior = [{ key: "x::y", text: "undo goes one step short after merging cells", ref: "#9" }];
  assert.equal(findDuplicate(item(), prior), null);
});

test("the duplicate threshold is a stated number, not a mood", () => {
  assert.ok(DUPLICATE_OVERLAP > 0 && DUPLICATE_OVERLAP < 1);
});

test("redaction covers the text that gets published, and leaves references alone", () => {
  const secret = "ghp_0123456789abcdef0123456789abcdef0123";
  process.env.WB_TEST_TOKEN_FOR_REDACTION = secret;
  try {
    const redacted = redactItem(
      item({
        note: `the token ${secret} shows in the toolbar`,
        draft: { title: `leak ${secret}`, body: `body ${secret}`, kind: "copy" },
        target: { kind: "dom", selector: "div > button", tag: "button", text: secret },
        capture: { id: "cap-1" },
      }),
    );
    for (const text of [redacted.note, redacted.draft.title, redacted.draft.body, redacted.target.text]) {
      assert.ok(!text.includes(secret), `secret survived in ${JSON.stringify(text)}`);
    }
    // The capture reference is not prose and must not be rewritten, or the
    // bundle stops matching the image on disk.
    assert.equal(redacted.capture.id, "cap-1");
  } finally {
    delete process.env.WB_TEST_TOKEN_FOR_REDACTION;
  }
});

test("planIntake routes every kept item exactly once and carries the groups through", () => {
  const plan = planIntake(bundle());
  assert.equal(plan.items.length, 3);
  assert.equal(plan.groups.length, 2);
  assert.equal(
    plan.items.reduce((n, i) => n + (i.route ? 1 : 0), 0),
    3,
  );
  assert.equal(Object.values(plan.counts).reduce((a, b) => a + b, 0), 3);
  // Nothing has happened yet, and the plan says so.
  assert.equal(plan.filed, false);
});

test("planIntake leaves a discarded item out", () => {
  const b = bundle();
  b.items[0].disposition = "discard";
  const plan = planIntake(b);
  assert.deepEqual(
    plan.items.map((i) => i.id),
    ["i2", "i3"],
  );
});

test("planIntake reports a missing image against the item that lost it", () => {
  const plan = planIntake(bundle(), {
    missing: [{ id: "i2", note: "the merged cell border looks broken", capture: "cap-1" }],
  });
  const item2 = plan.items.find((i) => i.id === "i2");
  assert.equal(plan.missingCaptures.length, 1);
  assert.ok(item2.route.destination);
});

test("renderPlan says what will happen, including that the shape may change", () => {
  const text = renderPlan(planIntake(bundle()));
  assert.match(text, /3 report\(s\)/);
  assert.match(text, /may split or merge them and will say why/);
});

// --- regressions from the PR ④ review ---------------------------------------

test("an appearance word containing a hint is not a described sequence", () => {
  // Substring matching routed these to the replay lane and stripped the lens:
  // "press" is inside "expression", "type" inside "typeface", "then" inside
  // "strengthen", "open" inside "reopen".
  for (const note of [
    "the expression bar text is cramped",
    "the typeface looks too heavy here",
    "the borders strengthen too much on hover",
    "the reopen affordance is invisible",
  ]) {
    assert.equal(looksReplayable(note), false, note);
  }
  // …and the real thing still routes.
  for (const note of ["after I clicked save it vanished", "when I type a formula it lags"]) {
    assert.equal(looksReplayable(note), true, note);
  }
});

test("every appearance route carries the lens that judges it", () => {
  // The `publish` branch built its own route object and omitted the lens, so the
  // one route where the reporter had been most explicit lost its gate.
  const routes = [
    routeItem({ note: "file this one please", disposition: "publish" }),
    routeItem({ note: "the icons are cramped", draft: { kind: "spacing" } }),
    routeItem({ note: "this whole panel looks off" }),
  ];
  for (const route of routes) {
    assert.equal(route.destination, "appearance");
    assert.equal(route.lens, "visual-intent", route.reason);
  }
});

test("a region's on-screen text is redacted, like a DOM target's", () => {
  const key = `sk-ant-api03-${"A".repeat(48)}`;
  const redacted = redactItem({
    note: "the form is misaligned",
    target: {
      kind: "viewport",
      elements: [
        { tag: "input", text: key },
        { tag: "span", text: "Sign in" },
      ],
    },
  });
  assert.ok(
    !JSON.stringify(redacted).includes(key),
    "a region report published an on-screen credential the DOM path masks",
  );
  assert.equal(redacted.target.elements[1].text, "Sign in", "ordinary text survives");
});

test("a Korean report can reach the replay lane", () => {
  // Reported from the running app: `SEQUENCE_HINTS` was English-only, so a
  // Korean sentence could not be replayed whatever it described. Nothing was
  // lost — the appearance lane still reviewed it — but the
  // automatic-reproduction half was unreachable for a whole language.
  for (const note of [
    "두 줄 이상의 내용에 링크가 들어가면 link formatting이 깨짐",
    "저장하고 나서 다시 열면 값이 사라져요",
    "붙여넣으면 서식이 날아갑니다",
    "행을 삭제한 뒤 undo하면 복구가 안 돼요",
  ]) {
    assert.equal(looksReplayable(note), true, note);
  }
});

test("Korean appearance vocabulary is not a described sequence", () => {
  // The guard that makes the Korean list safe. Korean verbs take endings, so
  // the stems are matched as SUBSTRINGS — which is why the bare `-면` ending is
  // deliberately absent: it appears in 화면 (screen), the most common word in a
  // UI report, and would route nearly everything to replay.
  for (const note of [
    "툴바 아이콘이 너무 붙어 있어요",
    "글꼴이 이상해 보입니다",
    "화면 여백이 너무 넓어요",
    "색상 대비가 부족합니다",
    "정렬이 어긋나 있어요",
    "간격이 좁습니다",
  ]) {
    assert.equal(looksReplayable(note), false, note);
  }
});

test("the Korean list is consulted only for a sentence containing Hangul", () => {
  // Not a correctness guard — Korean stems can only match Hangul anyway. It
  // keeps one rule per language: English is word-boundary matched, Korean is
  // substring matched, and which applies is decided before either runs.
  assert.equal(looksReplayable("pressure from the compressed expression"), false);
  // A MIXED sentence still reaches it. The report this came from was
  // "링크가 들어가면 link formatting이 깨짐"; requiring pure Korean would have
  // missed exactly the sentences people write.
  assert.equal(looksReplayable("링크가 들어가면 link formatting이 깨짐"), true);
});
