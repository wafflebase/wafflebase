// Which tests did a fix round take away?
//
// Ported from yorkie-js-sdk (#1432 there); the incident numbers below are that
// repository's. What differs here is the test layout this repo runs — see
// `isRunnableTest` and `CASE`.
//
// WHY THIS EXISTS. On #1426 (e6900da) the fixer wrote a two-replica test for a
// finding, watched it fail, DELETED it, and reported the finding "Fixed" with a
// caveat in prose. The next round's adjudicator was told "a claim of having
// fixed something is not evidence that it was fixed" — and was given nothing
// else to go on. Weakened tests were left entirely to the test-adequacy lens
// (checks.mjs says as much), which reads the cumulative diff and cannot see a
// test that was written and removed between two of its rounds.
//
// This is the mechanical half. A trusted `fix-evidence` job (one in each fixer
// workflow) reads the round's commits through the API — never a checkout the
// agent touched — and when a test file was deleted, renamed out of the
// runner's reach, lost active cases, or had a suite switched off, posts a
// `<!-- agent-fix-tests -->` record as `github-actions[bot]`. The next round
// puts it in front of the adjudicator, before the author's fence, for every
// claim and dispute it adjudicates (fix-report.mjs, rebuttal.mjs). It decides
// nothing itself: a removed test can be a legitimate cleanup, so it is
// EVIDENCE for a component that already re-reads the code, not a gate.
//
// PER COMMIT, NOT ONE COMPARE. A three-dot compare diffs from the merge base:
// a merge of main would be blamed on the fixer, a test committed and deleted
// inside the round would not show at all, and only 300 files are listed. So the
// round's OWN commits are taken (`pushedRoundCommits`: in one of the fixer's
// pushes, in the PR's commit list, not merges) and each commit's files are
// summed per path.
//
// WHAT IT CANNOT SEE, stated because #1426 is the case that motivated it and is
// one it would NOT have caught: there the test was written and deleted in the
// working tree and never committed, so no commit ever held it. Only COMMITTED
// tests are visible. The fixer prompt's rule — keep a reproducing test as
// `it.fails`, never delete it — is the only guard for the uncommitted case. A
// force-push that dropped commits is flagged (`rewritten`) rather than hidden:
// the dropped commits are gone from the API too.
//
// WHICH COMMITS ARE THE ROUND'S is bounded by the fixer credential's own
// pushes, read from the repository activity log (`fixerPushes`), never by the
// branch head when this runs: a human's push after the fixer is not its work.
//
// Usage:
//   node test-removals.mjs post <pr> --before <sha> --branch <name>
//     --actor <app-slug>[bot] --since <iso8601> [--head <sha>]
// `--actor` and `--since` come from fix-job steps that ran BEFORE the agent
// (the App token's slug, the before-fix stamp). `--head` is the sha the fix
// report names (the round's reviewed head), which the record is joined on; it
// defaults to `--before`. Posts only when something was removed, history was
// rewritten, or the round was not fully read. Always exits 0: an unread round is "no
// evidence", which is exactly the behaviour before this existed.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_REMOVALS_MARKER = "<!-- agent-fix-tests ";
export const TEST_REMOVALS_VERSION = 1;
/** The one identity whose records are believed: the trusted job's GITHUB_TOKEN. */
export const TEST_REMOVALS_AUTHOR_LOGIN = "github-actions[bot]";

const str = (v) => (typeof v === "string" ? v : "");
const int = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

/**
 * A path as it may be RENDERED: control characters (newlines included — git
 * allows them in paths) become spaces, backticks become quotes. File names come
 * from the branch, and they are printed in a block labelled "the author did not
 * write this"; a newline would let a path write its own line there.
 */
export function safePath(file) {
  // eslint-disable-next-line no-control-regex
  return str(file).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/`/g, "'").slice(0, 300);
}

/** This repo's test layouts: `test/` and `tests/` trees, `__tests__/`, and every name a runner picks up. */
export function isTestFile(file) {
  const f = str(file);
  return /(^|\/)(test|tests|__tests__)\//.test(f) || isRunnableTest(f);
}

/**
 * A file a runner picks up by NAME, wherever it lives. This repo's runners:
 *   `*.test.{ts,tsx,mjs,…}`  Vitest (the engine packages, frontend) and
 *                            `node --test` (scripts/, scripts/agent/)
 *   `*.spec.ts`              Jest, packages/backend (`testRegex: .spec.ts$`)
 *   `*.e2e-spec.ts`          Jest, packages/backend/test/jest-e2e.json
 *   `*.integration.ts`       `tsx --test`, packages/frontend (test:integration)
 * Dot-separated only, unlike the js-sdk copy's `[._]`: no runner here collects
 * `_test` or `-test`, and `hit-test.ts` (packages/slides) is source.
 */
export function isRunnableTest(file) {
  return /\.(?:test|spec|e2e-spec|integration)\.[cm]?[jt]sx?$/.test(str(file));
}

// An ACTIVE case declaration at the start of a diff line: `it`/`test` with any
// chain of the modifiers that still RUN (`only`, `each`, `concurrent`, `fails`,
// `sequential`, `for`; Jest's `failing`), called or tagged (`test.each\`…\``),
// or Jest's focused `fit` — only with a string title, because this repo has a
// local `fit()` helper (`fit-to-content.test.ts`) whose calls are not cases.
// `.fails` (Vitest) and `.failing` (Jest) run and assert the failure — how a
// fixer should record a reproduction it could not fix — so turning a case into
// one is not a removal. `.skip`, `.todo`, `.skipIf(…)`, `.runIf(…)` and Jest's
// `xit`/`xtest` may not run: a case rewritten to one stops matching, which
// counts it removed.
const CASE = /^[-+]\s*(?:(?:it|test)(?:\.(?:only|each|concurrent|fails|failing|sequential|for))*\s*[(`]|fit\s*\(\s*['"`])/;
// A FOCUS: the focused case runs, and every sibling silently stops. Jest has
// no CI guard (`CI=true jest --ci` reports "1 skipped, 1 passed", exit 0) and
// this repo has no `no-focused-tests` rule. Vitest rejects `.only` under CI,
// but counting it everywhere is simpler and costs nothing. Counted apart from
// cases and netted only against itself, like a suite switched off.
const FOCUS = /^[-+]\s*(?:(?:it|test|describe)(?:\.\w+)*\.only|fdescribe|fit(?=\s*\(\s*['"`]))\s*[(`]/;
// node:test's OPTION form, `test("x", { todo: … }, fn)` / `{ skip: … }`: the
// case still runs (todo) or is skipped, and a failure no longer fails the
// suite. It is the form the fixer prompt gives for node:test files, so a newly
// added one is evidence, netted only against lines that already carried it.
const OPTION_OFF = /,\s*\{[^}]*\b(?:todo|skip)\s*:/;
// The same option once Prettier has WRAPPED the call: the prompt's
// `test("long title", { todo: '…' }, async () => {…})` overflows 80 columns,
// and Prettier puts the opener, the title, the options and the callback on
// lines of their own, the object itself broken one key per line when long:
//
//   test(                                test(
//     'long title',                        'long title',
//     { todo: 'still reproduces: …' },     {
//     async () => {                          timeout: 5000,
//                                            skip: !shouldRun,
//                                          },
//
// Recognised only in that slot — a bare case opener, a title that starts with
// a quote, then the object — so a `test.each` table, a look-alike call or an
// object in the body never counts (`wrappedOptions`).
const WRAPPED_OPENER = /^\s*(?:it|test)(?:\.(?:only|concurrent|fails|failing|sequential))*\s*\(\s*$/;
const WRAPPED_TITLE = /^\s*['"`]/;
const OPTION_KEY = /(?:^|[{,])\s*(?:todo|skip)\s*:/;
// A suite that may not run. Counted apart from cases and never netted against
// added ones: one `describe.skip` silences every case under it without those
// lines changing, so "one suite off, one case added" must still be reported.
// Jest's `xdescribe` is the same switch spelled as a prefix.
const SUITE_OFF = /^[-+]\s*(?:describe(?:\.\w+)*\.(?:skip|todo|skipIf|runIf)|xdescribe(?:\.\w+)*)\s*[(`]/;

/**
 * The RAW counters of one patch: active cases removed and added, and each
 * switch (suite off, focus, node:test option) as lines added and removed. Raw,
 * so a round's commits can be summed per path before anything is clamped — a
 * suite skipped in one commit and re-enabled in the next is no disablement.
 */
function tally(patch) {
  const t = { removed: 0, added: 0, offAdded: 0, offRemoved: 0, focusAdded: 0, focusRemoved: 0, optAdded: 0, optRemoved: 0 };
  const wrapped = wrappedOptions(patch);
  t.optAdded += wrapped.added;
  t.optRemoved += wrapped.removed;
  for (const line of str(patch).split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    const plus = line[0] === "+";
    if (line[0] !== "+" && line[0] !== "-") continue;
    if (FOCUS.test(line)) plus ? t.focusAdded++ : t.focusRemoved++;
    if (SUITE_OFF.test(line)) {
      plus ? t.offAdded++ : t.offRemoved++;
      continue;
    }
    if (!CASE.test(line)) continue;
    plus ? t.added++ : t.removed++;
    if (OPTION_OFF.test(line)) plus ? t.optAdded++ : t.optRemoved++;
  }
  return t;
}

/**
 * Options on WRAPPED case calls that a patch adds and removes. Each side of the
 * diff is read as its own file (context lines belong to both), so a call whose
 * opener and title are unchanged context still has its options slot found. An
 * option counts on a side only when its key line CHANGED on that side: an
 * existing `{ skip: !shouldRun },` left as context counts nowhere, and one
 * re-indented or re-wrapped is removed on one side and added on the other,
 * which nets to zero like the one-line form.
 */
function wrappedOptions(patch) {
  const out = { added: 0, removed: 0 };
  const sides = { "+": { phase: 0 }, "-": { phase: 0 } };
  for (const line of str(patch).split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("@@")) {
      sides["+"].phase = 0;
      sides["-"].phase = 0;
      continue;
    }
    const mark = line[0];
    if (mark !== " " && mark !== "+" && mark !== "-") continue;
    const text = line.slice(1);
    for (const side of mark === " " ? ["+", "-"] : [mark]) {
      const st = sides[side];
      const changed = mark === side;
      const hit = () => {
        if (changed && !st.counted) {
          out[side === "+" ? "added" : "removed"]++;
          st.counted = true;
        }
      };
      if (st.phase === 1) {
        st.phase = WRAPPED_TITLE.test(text) ? 2 : 0;
        if (st.phase) continue;
      } else if (st.phase === 2) {
        st.phase = 0;
        st.counted = false;
        if (/^\s*\{.*\}\s*,?\s*$/.test(text)) {
          if (OPTION_KEY.test(text)) hit();
          continue;
        }
        if (/^\s*\{\s*$/.test(text)) {
          st.phase = 3;
          st.depth = 0;
          continue;
        }
      } else if (st.phase === 3) {
        // One key per line at the object's own depth; a nested object's keys
        // are not the case's options.
        if (st.depth === 0 && /^\s*(?:todo|skip)\s*:/.test(text)) hit();
        const opens = (text.match(/[{[(]/g) ?? []).length;
        const closes = (text.match(/[}\])]/g) ?? []).length;
        st.depth += opens - closes;
        if (st.depth < 0) st.phase = 0;
        continue;
      }
      if (WRAPPED_OPENER.test(text)) st.phase = 1;
    }
  }
  return out;
}

/**
 * Clamp raw counters to the record shape. Each switch is netted against
 * ITSELF only, so editing an already-skipped suite's title, or re-enabling
 * one, is not a disablement, and none is ever netted against added cases.
 * `focused` / `optionsOff` are present only when non-zero.
 */
function settle(t) {
  const focused = Math.max(0, t.focusAdded - t.focusRemoved);
  const optionsOff = Math.max(0, t.optAdded - t.optRemoved);
  return {
    removed: t.removed, added: t.added, suitesOff: Math.max(0, t.offAdded - t.offRemoved),
    ...(focused ? { focused } : {}),
    ...(optionsOff ? { optionsOff } : {}),
  };
}

/** Active cases a unified diff removes and adds, and the switches it newly turns on. */
export function countCases(patch) {
  return settle(tally(patch));
}

const RAW_ZERO = () => tally("");

/** One commit's (or one compare's) files → per-path entries. Not yet filtered. */
function entries(files) {
  const out = [];
  for (const f of Array.isArray(files) ? files : []) {
    const now = str(f?.filename);
    const was = f?.status === "renamed" ? str(f?.previous_filename) : now;
    // A test RENAMED so the runner no longer picks it up (`a_test.ts` →
    // `a_test.ts.off`, or `_test` dropped from the name) no longer runs: that is
    // the old file deleted, wherever the new name lives.
    const renamedAway = f?.status === "renamed" && isRunnableTest(was) && !isRunnableTest(now);
    if (!isTestFile(now) && !renamedAway) continue;
    const deleted = f.status === "removed" || renamedAway;
    // GitHub omits `patch` for a diff too large to show. That is "unknown", not
    // "nothing removed". A PURE rename (`changes: 0`) also carries no patch, and
    // an unchanged file is not a removal; a rename that changed content is
    // unknown like any other unshown diff.
    if (typeof f.patch !== "string") {
      const pureRename = f.status === "renamed" && !renamedAway && !(Number(f.changes) > 0);
      if (!pureRename && (deleted || f.status === "modified" || f.status === "renamed")) {
        out.push({ file: was, deleted, ...RAW_ZERO(), unreadable: true });
      }
      continue;
    }
    out.push({ file: was, deleted, renamedAway, ...tally(f.patch) });
  }
  return out;
}

/** Keep only what is a removal: a deletion that held cases, a rename away, a net loss, a suite off, or unreadable. */
function removalsOf(list) {
  const out = [];
  for (const e of list) {
    const c = settle(e);
    const hit = e.unreadable || e.renamedAway || c.suitesOff > 0 || c.focused > 0 || c.optionsOff > 0
      || (e.deleted ? c.removed > 0 : c.removed > c.added);
    if (!hit) continue;
    out.push({ file: e.file, deleted: e.deleted, ...c, ...(e.unreadable ? { unreadable: true } : {}) });
  }
  return out;
}

/**
 * Test files a single file list shows deleted, renamed away, losing active
 * cases, or with a suite switched off. `files` is a commit's or a compare's
 * `files` array (`filename`, `status`, `patch`, `previous_filename`).
 */
export function testRemovals(files) {
  return removalsOf(entries(files));
}

/**
 * The same, summed per path across a round's commits. Merge commits are
 * skipped: they bring in main, not the fixer's work. A test added in one commit
 * and deleted in a later one is a deletion that held cases — exactly what a
 * three-dot compare cannot see.
 */
export function aggregateCommits(commits) {
  const byFile = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (Array.isArray(c?.parents) && c.parents.length > 1) continue;
    for (const e of entries(c?.files)) {
      const cur = byFile.get(e.file) ?? { file: e.file, deleted: false, ...RAW_ZERO() };
      // RAW counters summed across the round, clamped once in `removalsOf`.
      for (const k of Object.keys(RAW_ZERO())) cur[k] += e[k];
      cur.deleted = e.deleted || (cur.deleted && e.removed === 0 && e.added === 0);
      if (e.unreadable) cur.unreadable = true;
      if (e.renamedAway) cur.renamedAway = true;
      byFile.set(e.file, cur);
    }
  }
  return removalsOf([...byFile.values()]);
}

/**
 * The round's OWN commits: in the compare `before...after`, also in the PR's
 * commit list (which excludes everything already on the base branch), and not
 * merges. Measured on #1406: a merge of main lists main's commits in the
 * compare with ONE parent each, so "skip merges" alone would blame main's test
 * changes on the fixer. An unreadable PR list attributes nothing.
 */
export function roundCommits(compareCommits, prShas) {
  if (!(prShas instanceof Set)) return [];
  return (Array.isArray(compareCommits) ? compareCommits : [])
    .filter((c) => c && prShas.has(c.sha) && Number(c.n) === 1);
}

/** One page of the repository activity log; a full page may not reach back far enough. */
export const ACTIVITY_PAGE = 100;

/**
 * The pushes the FIXER made, oldest first. `activities` is
 * `GET /repos/{o}/{r}/activity?ref=refs/heads/<branch>` (newest first); `actor`
 * is the fixer credential's login (`<app-slug>[bot]`); `since` is when the
 * round started, stamped in the fix job BEFORE the agent ran.
 *
 * WHY PUSHES, NOT A HEAD. The record used to compare BEFORE against the branch
 * head read when `fix-evidence` ran, and that is not the fixer's head: the fix
 * job's reporting steps and a fresh runner's start sit between the agent's last
 * push and that read, and a commit a human pushed in the gap was blamed on the
 * fixer. Nothing trustworthy can name the fixer's head from inside the fix job —
 * every step after the agent runs on its terms, and its own report is a claim it
 * could stop short of the commit that deleted a test. Nor can the commits: their
 * author and committer are whatever the agent's git config says (`claude[bot]`
 * for every agent workflow here), so a fixer could sign as a human and end a
 * "stop at the first foreign commit" walk before its deletion. The activity log
 * names the AUTHENTICATED pusher, which GitHub sets from the token, so the
 * round's commits are exactly the ones its credential pushed after it started,
 * wherever a human's push fell between them.
 */
export function fixerPushes(activities, { actor = "", since = "", pageSize = ACTIVITY_PAGE } = {}) {
  const start = Date.parse(str(since));
  const list = Array.isArray(activities) ? activities : [];
  if (!str(actor) || !Number.isFinite(start)) return { pushes: [], truncated: false };
  const at = (a) => Date.parse(str(a?.timestamp));
  const pushes = list
    .filter((a) => (a?.activity_type === "push" || a?.activity_type === "force_push")
      && a?.actor?.login === actor && at(a) >= start
      && !/^0*$/.test(str(a?.before)) && !/^0*$/.test(str(a?.after)))
    .sort((x, y) => at(x) - at(y))
    .map((a) => ({ before: a.before, after: a.after, forced: a.activity_type === "force_push" }));
  // A full page whose oldest entry is still inside the round may have cut off
  // the round's first pushes.
  const oldest = list.reduce((m, a) => Math.min(m, at(a)), Infinity);
  return { pushes, truncated: list.length >= pageSize && oldest >= start };
}

/**
 * The round's own commits from the fixer's pushes: each push's compare
 * commits, kept by `roundCommits` (in the PR's commit list, not merges), each
 * sha once, in push order.
 */
export function pushedRoundCommits(perPush, prShas) {
  const seen = new Set();
  const out = [];
  for (const commits of Array.isArray(perPush) ? perPush : []) {
    for (const c of roundCommits(commits, prShas)) {
      if (seen.has(c.sha)) continue;
      seen.add(c.sha);
      out.push(c);
    }
  }
  return out;
}

/** Read at most this many of a round's commits; more is flagged `truncated`. */
export const ROUND_COMMIT_CAP = 50;

/** The first `cap` commits, and whether any were left unread. */
export function capRoundCommits(commits, cap = ROUND_COMMIT_CAP) {
  const list = Array.isArray(commits) ? commits : [];
  return { commits: list.slice(0, cap), truncated: list.length > cap };
}

/** The hidden record. The terminator is escaped, as every record here does. */
export function serializeTestRemovals({ head = "", after = "", removals = [], rewritten = false, truncated = false } = {}) {
  const payload = {
    v: TEST_REMOVALS_VERSION,
    head: str(head).slice(0, 64),
    after: str(after).slice(0, 64),
    ...(rewritten ? { rewritten: true } : {}),
    ...(truncated ? { truncated: true } : {}),
    removals: (Array.isArray(removals) ? removals : []).slice(0, 40).map((r) => ({
      file: safePath(r.file),
      deleted: r.deleted === true,
      removed: int(r.removed),
      added: int(r.added),
      suitesOff: int(r.suitesOff),
      ...(int(r.focused) ? { focused: int(r.focused) } : {}),
      ...(int(r.optionsOff) ? { optionsOff: int(r.optionsOff) } : {}),
      ...(r.unreadable === true ? { unreadable: true } : {}),
    })),
  };
  return `${TEST_REMOVALS_MARKER}${JSON.stringify(payload).replace(/-->/g, "-\\u002d>")} -->`;
}

/** One removal as a line. Deletion first: a deleted file is never "merely changed". */
export function describeRemoval(r) {
  const file = `\`${safePath(r?.file)}\``;
  if (r?.deleted === true) {
    return r?.unreadable === true || !int(r?.removed)
      ? `- deleted ${file} (the whole file stopped running)`
      : `- deleted ${file} (${int(r.removed)} case(s))`;
  }
  if (r?.unreadable === true) return `- ${file}: changed, but the diff was too large to read`;
  const parts = [];
  if (int(r?.removed) || int(r?.added)) parts.push(`${int(r?.removed)} active case(s) removed or disabled, ${int(r?.added)} added`);
  if (int(r?.suitesOff)) parts.push(`${int(r.suitesOff)} suite(s) switched off`);
  if (int(r?.focused)) parts.push(`${int(r.focused)} focus(es) added (\`.only\`/\`fit\`/\`fdescribe\`), which stops every sibling`);
  if (int(r?.optionsOff)) parts.push(`${int(r.optionsOff)} case(s) given a \`{ todo }\`/\`{ skip }\` option`);
  return `- ${file}: ${parts.join("; ")}`;
}

/** Visible lines plus the hidden record. Every `<!--` in the visible part is broken. */
export function renderTestRemovals(rec) {
  const list = Array.isArray(rec?.removals) ? rec.removals : [];
  const lines = [
    `🧪 **This fix round removed or disabled tests in ${list.length} file(s)** between \`${safePath(rec?.head).slice(0, 9)}\` and \`${safePath(rec?.after).slice(0, 9)}\`. ` +
      "Removing a test can be legitimate; this is passed to the next round's adjudicator as evidence.",
    ...(rec?.rewritten ? ["", "⚠️ The branch history was rewritten during the round, so commits it dropped could not be read."] : []),
    ...(rec?.truncated ? ["", `⚠️ The round had more than ${ROUND_COMMIT_CAP} commits; only the first ${ROUND_COMMIT_CAP} were read.`] : []),
    "",
    ...list.map(describeRemoval),
  ].join("\n").replace(/<!--/g, "<!-‌-");
  return `${lines}\n\n${serializeTestRemovals(rec)}`;
}

/** Every believable record on the PR, in comment order. */
export function collectTestRemovals(comments) {
  const out = [];
  for (const c of Array.isArray(comments) ? comments : []) {
    if (c?.user?.type !== "Bot" || c?.user?.login !== TEST_REMOVALS_AUTHOR_LOGIN) continue;
    const m = new RegExp(`${TEST_REMOVALS_MARKER}([\\s\\S]*?) -->`).exec(str(c.body));
    if (!m) continue;
    let d;
    try {
      d = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (!d || typeof d !== "object" || d.v !== TEST_REMOVALS_VERSION || !Array.isArray(d.removals)) continue;
    // An EMPTY record is refused unless it says the round was not fully read
    // (history rewritten, or commits past the cap): an empty list could only
    // ever hide a real record for the same head.
    if (d.removals.length === 0 && d.rewritten !== true && d.truncated !== true) continue;
    out.push({
      head: str(d.head), after: str(d.after),
      ...(d.rewritten === true ? { rewritten: true } : {}),
      ...(d.truncated === true ? { truncated: true } : {}),
      removals: d.removals.map((r) => ({ ...r, file: safePath(r?.file) })),
    });
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const [verb, pr] = argv;
  const flag = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? str(argv[i + 1]) : "";
  };
  const before = flag("before");
  const branch = flag("branch");
  const actor = flag("actor");
  const since = flag("since");
  const head = /^[0-9a-f]{7,40}$/i.test(flag("head")) ? flag("head") : before;
  if (verb !== "post" || !/^\d+$/.test(str(pr)) || !/^[0-9a-f]{40}$/i.test(before) || !branch
    || !/^[A-Za-z0-9-]+\[bot\]$/.test(actor) || !Number.isFinite(Date.parse(since))) {
    console.error("usage: test-removals.mjs post <pr> --before <sha40> --branch <name> --actor <app>[bot] --since <iso8601> [--head <sha>]");
    return;
  }
  const ghJson = (args) => JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const ghLines = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  let commits;
  let after = "";
  let rewritten = false;
  let truncated = false;
  try {
    // The fixer's pushes, not the branch head (`fixerPushes` says why).
    const ref = encodeURIComponent(`refs/heads/${branch}`);
    const activity = ghJson(["api", `repos/{owner}/{repo}/activity?ref=${ref}&per_page=${ACTIVITY_PAGE}`]);
    const found = fixerPushes(activity, { actor, since });
    truncated = found.truncated;
    const pushes = found.pushes.filter((p) => /^[0-9a-f]{40}$/i.test(p.before) && /^[0-9a-f]{40}$/i.test(p.after));
    if (pushes.length === 0) {
      console.error(`test-removals: ${actor} pushed nothing to ${branch} since ${since}; recording nothing.`);
      return;
    }
    after = pushes[pushes.length - 1].after;
    const perPush = [];
    for (const p of pushes) {
      // Each compare is used for its COMMIT list and status only — the commits
      // paginate cleanly; the file list does not (it is capped and lives on page 1).
      const status = ghJson(["api", `repos/{owner}/{repo}/compare/${p.before}...${p.after}`, "--jq", "{status: .status, behind: .behind_by}"]);
      if (p.forced || status.status === "diverged" || Number(status.behind) > 0) rewritten = true;
      perPush.push(ghLines(["api", "--paginate", `repos/{owner}/{repo}/compare/${p.before}...${p.after}?per_page=100`, "--jq", ".commits[] | {sha, n: (.parents | length)}"]));
    }
    // `--jq` prints a bare string RAW, not as JSON, so the shas are emitted as
    // JSON strings (`tojson`) to go through the same line parser.
    const prShas = new Set(ghLines(["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`, "--jq", ".[].sha | tojson"]));
    commits = [];
    const capped = capRoundCommits(pushedRoundCommits(perPush, prShas));
    truncated = truncated || capped.truncated;
    for (const { sha } of capped.commits) {
      const files = ghLines(["api", "--paginate", `repos/{owner}/{repo}/commits/${sha}?per_page=100`, "--jq", ".files[]"]);
      commits.push({ sha, parents: [{}], files });
    }
  } catch (err) {
    console.error(`test-removals: could not read the round's commits (${err.message}); recording nothing.`);
    return;
  }
  const removals = aggregateCommits(commits);
  if (removals.length === 0 && !rewritten && !truncated) {
    console.error("test-removals: the fix round removed no test.");
    return;
  }
  try {
    execFileSync("gh", ["pr", "comment", pr, "--body-file", "-"], {
      input: renderTestRemovals({ head, after, removals, rewritten, truncated }), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    });
    console.error(`test-removals: recorded ${removals.length} file(s)${rewritten ? " (history rewritten)" : ""}.`);
  } catch (err) {
    console.error(`test-removals: could not post (${err.message}).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
