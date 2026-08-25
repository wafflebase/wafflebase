// Decide what happens to each report a person confirmed.
//
// This is the step between "a bundle landed" and "something was filed": redact,
// drop what is already known, route each item to a destination, and emit a plan.
// It FILES NOTHING and it RUNS NOTHING — a plan is data, and the two scripts that
// act on it (`report-verify.mjs`, `report-to-pr.mjs`) take it as input. Keeping
// the decision separate from the action is what makes `--dry-run` the same code
// path as a real run.
//
// The rules it applies are in `docs/design/debug-report.md`:
//
//   | verdict            | condition                              | destination |
//   | bug, verifiable    | reproduction steps, replayable         | verify → PR |
//   | appearance         | no prediction, no plan                 | PR + visual-intent lens |
//   | duplicate          | matches a report already known         | comment on that issue |
//   | thin               | nothing an agent could act on          | issue, asking for more |
//
// A destination is never a deletion. `hunt-ui`'s replay saying "not reproduced"
// does not mean the observation was wrong — the documented failure where a
// reader's scope is wider than the action is real — so failure LOWERS the
// destination and files the expectation and the failed replay together, leaving
// the discrepancy for a person rather than resolving it by machine.
//
// Usage:
//   node report-intake.mjs --source .wb-reports/<session> [--dry-run] [--out plan.json]
//   node report-intake.mjs --source <dir> --prior prior-reports.json
//   node report-intake.mjs --source <dir> --issues [--repo owner/name]
//
// `--issues` also checks the repository's OPEN ISSUES, so a defect someone else
// already reported comes back as a comment rather than a second PR. Off by
// default: it shells out to `gh`, and an intake run must work offline.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureDir, missingCaptures, readBundle } from "./report-bundle.mjs";
import { openIssuesAsPrior } from "./report-prior.mjs";
import { redactSecrets } from "./redact.mjs";
import { findingKey } from "./finding-key.mjs";
import { crossArmTokenOverlap, tokenOverlap } from "./finding-match.mjs";

/** Above this, two reports are the same report. */
export const DUPLICATE_OVERLAP = 0.6;

/** A note shorter than this cannot carry an actionable observation. */
export const MIN_ACTIONABLE_NOTE = 12;

export const DESTINATIONS = ["verify", "appearance", "duplicate", "thin"];

/**
 * Kinds whose reports have no replayable plan.
 *
 * `hunt-ui` needs a prediction and a sequence of actions; "the padding is too
 * tight" has neither. These skip replay and are gated by the `visual-intent`
 * lens instead — they do NOT skip review.
 */
export const APPEARANCE_KINDS = ["spacing", "color", "token", "copy", "a11y"];

/**
 * Words that mean the reporter described a SEQUENCE.
 *
 * A deliberately small, boring list. The alternative — asking a model whether a
 * sentence is replayable — would put a judgement call in front of the routing
 * decision, and this one is cheap to read and cheap to argue with.
 */
const SEQUENCE_HINTS = [
  "after",
  "when i",
  "then",
  "click",
  "clicked",
  "press",
  "pressed",
  "type",
  "typed",
  "undo",
  "redo",
  "reload",
  "refresh",
  "drag",
  "dragged",
  "select",
  "selected",
  "open",
  "opened",
  "save",
  "saved",
];

/**
 * The same, in Korean.
 *
 * SEPARATE FROM THE ENGLISH LIST because the matching rule differs. English
 * needs `\b` — "press" inside "expression" is not a step. Korean has no such
 * boundary: verbs take endings ("클릭하면", "눌렀을", "저장한"), so the stem is a
 * SUBSTRING by construction and a boundary test would reject every real form.
 *
 * Reported from the running app: a Korean sentence could not reach the replay
 * lane at all, whatever it described. Nothing was lost — the appearance lane
 * still reviews it — but the automatic-reproduction half was unreachable for a
 * whole language.
 */
const SEQUENCE_HINTS_KO = [
  "클릭",
  "누르",
  "눌렀",
  "눌러",
  "입력",
  "타이핑",
  "드래그",
  "선택",
  "저장",
  "새로고침",
  "리로드",
  "되돌리",
  "undo",
  "redo",
  "열었",
  "열면",
  "이동",
  "한 다음",
  "한 뒤",
  "하고 나",
  "하면",
  "했을",
  "하니까",
  // Action VERB STEMS, which is what carries a step in Korean. Deliberately not
  // the bare "-면" ending: it would match 화면 (screen), the most common word in
  // a UI report, and route nearly everything to replay.
  "들어가",
  "붙여넣",
  "지우",
  "삭제",
  "복사",
  "스크롤",
  "바꾸",
  "추가하",
];

/**
 * Matched on WORD BOUNDARIES, not as substrings.
 *
 * A raw `includes` routed ordinary appearance prose to the replay lane: "press"
 * is inside "expression", "impression" and "compressed"; "type" inside
 * "typeface" and "prototype"; "then" inside "strengthen"; "open" inside
 * "reopen". "The expression bar text is cramped" describes no steps at all and
 * was called replayable.
 */
const escape = (h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SEQUENCE_RE = new RegExp(`\\b(${SEQUENCE_HINTS.map(escape).join("|")})\\b`, "i");

/** Korean stems, matched as substrings — see `SEQUENCE_HINTS_KO`. */
const SEQUENCE_RE_KO = new RegExp(SEQUENCE_HINTS_KO.map(escape).join("|"));

/** Hangul syllables and jamo — enough to say "this sentence is Korean". */
const HANGUL = /[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/;

/**
 * Whether the sentence describes steps a replay could follow.
 *
 * The Korean list is consulted ONLY for a sentence that contains Hangul. Its
 * stems can only match Hangul anyway, so this is not about correctness — it is
 * about keeping one rule per language readable: English is word-boundary
 * matched, Korean is substring matched, and which applies is decided before
 * either runs rather than by whichever happens to hit.
 *
 * A mixed sentence still reaches the Korean list — the report this came from was
 * "링크가 들어가면 link formatting이 깨짐", and requiring a pure-Korean note would
 * have missed exactly the sentences people actually write.
 */
export function looksReplayable(note) {
  const text = String(note ?? "");
  if (SEQUENCE_RE.test(text)) return true;
  return HANGUL.test(text) && SEQUENCE_RE_KO.test(text);
}

/**
 * Everything about an item that could carry a secret.
 *
 * Redaction runs over the TEXT the pipeline is about to publish, not over the
 * bundle as a whole: the capture ids and the geometry are not prose and cannot
 * hold a token, and rewriting them would break the references to the images on
 * disk.
 */
export function redactItem(item) {
  const redacted = { ...item, note: redactSecrets(String(item.note ?? "")) };
  if (item.draft) {
    redacted.draft = {
      ...item.draft,
      title: redactSecrets(String(item.draft.title ?? "")),
      body: redactSecrets(String(item.draft.body ?? "")),
    };
  }
  // EVERY on-screen text excerpt, not only a DOM target's. A region report over
  // a login form, a settings screen or an API-key dialog carries the same class
  // of text in `elements[].text`, and `types.ts` calls that excerpt "the agent's
  // only grep key into the source" — i.e. it is meant to be read downstream.
  // Masking one field and copying the other verbatim is not a redaction.
  if (item.target) {
    const target = { ...item.target };
    if (typeof target.text === "string") target.text = redactSecrets(target.text);
    if (Array.isArray(target.elements)) {
      target.elements = target.elements.map((el) =>
        typeof el?.text === "string" ? { ...el, text: redactSecrets(el.text) } : el,
      );
    }
    redacted.target = target;
  }
  return redacted;
}

/** The text two reports are compared on. */
function comparableText(item) {
  return [item.note, item.draft?.title, item.target?.address, item.target?.selector]
    .filter(Boolean)
    .join(" ");
}

/**
 * A stable key for "the same defect reported again".
 *
 * Reuses `findingKey`, which the review panel already uses for the same job, so
 * a report and a review finding about one place collapse the same way. The
 * "file" slot carries the semantic address where there is one — `Sheet1!C7` is a
 * better identity than a selector built out of utility classes.
 */
export function reportKey(item) {
  const where =
    item.target?.address ??
    item.target?.testId ??
    item.target?.selector ??
    item.target?.surface ??
    "";
  return findingKey({ file: where, summary: item.draft?.title ?? item.note });
}

/**
 * Whether this report is one already known.
 *
 * Two tests, and the cheap one first: an identical key is a duplicate outright;
 * otherwise a high token overlap on the prose. `tokenOverlap` is the same
 * measure the panel uses to collapse findings, so "same defect" means the same
 * thing in both places.
 */
export function findDuplicate(item, prior) {
  const key = reportKey(item);
  const exact = prior.find((p) => p.key === key);
  if (exact) return { match: exact, why: "same place, same summary" };

  const text = comparableText(item);
  let best;
  for (const candidate of prior) {
    const overlap = overlapFor(candidate)(text, candidate.text ?? "");
    if (overlap >= DUPLICATE_OVERLAP && (!best || overlap > best.overlap)) {
      best = { match: candidate, overlap };
    }
  }
  return best
    ? {
        match: best.match,
        why: `${Math.round(best.overlap * 100)}% overlap with ${
          best.match.source === "issue" ? `${best.match.ref} “${best.match.title}”` : "what it says"
        }`,
      }
    : null;
}

/**
 * Which overlap measure applies to this candidate.
 *
 * A LEDGER entry is one sentence against one sentence, and `tokenOverlap`
 * (containment, `shared / min(|a|, |b|)`) is defensible there: one side
 * restating the other at more length is real evidence.
 *
 * AN ISSUE IS NOT. Its body is paragraphs against a single sentence, and
 * containment's own docblock says it is "BLIND TO THE LONGER OPERAND" — any
 * issue whose body happens to contain most of a short sentence's words scores
 * 1.0. That would route a real report to `duplicate`, comment on an unrelated
 * issue, and never file it: a report lost behind a wrong match, which is the one
 * outcome this pipeline exists to prevent. Dice divides by the sum, so a long
 * body pulls the score down instead of up.
 */
function overlapFor(candidate) {
  return candidate?.source === "issue" ? crossArmTokenOverlap : tokenOverlap;
}

/**
 * Where one item goes.
 *
 * `disposition` is the reporter's own instruction and outranks the heuristics:
 * `publish` means "file it, do not replay it", and second-guessing that would
 * make their choice decorative.
 */
function appearance(reason, capturePresent) {
  return {
    destination: "appearance",
    reason,
    // ATTACHED HERE, not per branch. The `publish` branch built its own
    // appearance route and omitted this, so an item the reporter explicitly
    // asked to file reached `toPr` with `lens: null` and its PR body never said
    // which lens judged it — the one route where the reporter had been most
    // explicit was the one that lost its gate.
    lens: "visual-intent",
    // An appearance verdict rests on before/after/diff images. Saying so here
    // means the missing evidence is visible in the plan rather than surfacing as
    // a lens with nothing to look at.
    ...(capturePresent ? {} : { warning: "no image on disk for this report" }),
  };
}

export function routeItem(item, { prior = [], capturePresent = true } = {}) {
  const duplicate = findDuplicate(item, prior);
  if (duplicate) {
    return {
      destination: "duplicate",
      reason: `already reported (${duplicate.why})`,
      duplicateOf: duplicate.match.ref ?? duplicate.match.key,
    };
  }

  if (String(item.note ?? "").trim().length < MIN_ACTIONABLE_NOTE) {
    return {
      destination: "thin",
      reason: "the sentence is too short for anyone to act on; filed asking for more",
    };
  }

  if (item.disposition === "publish") {
    return appearance("the reporter asked for it to be filed, not replayed", capturePresent);
  }

  const kind = item.draft?.kind;
  if (kind && APPEARANCE_KINDS.includes(kind)) {
    return appearance(
      `a ${kind} change has no prediction to replay; the visual-intent lens judges it`,
      capturePresent,
    );
  }

  if (looksReplayable(item.note)) {
    return { destination: "verify", reason: "the sentence describes steps a replay can follow" };
  }

  return appearance(
    "no steps to replay; treated as an appearance report and reviewed by the lens",
    capturePresent,
  );
}

/**
 * The plan for a whole bundle.
 *
 * Every item appears exactly once, and the groups are carried through unchanged:
 * the shape the reporter approved is an INPUT to PR assembly, which is the only
 * step allowed to adjust it — and only while recording the delta.
 */
export function planIntake(bundle, { prior = [], missing = [] } = {}) {
  const missingByItem = new Set(missing.map((m) => m.id));
  const items = bundle.items
    .filter((item) => item.disposition !== "discard")
    .map((item) => {
      const redacted = redactItem(item);
      return {
        ...redacted,
        key: reportKey(redacted),
        route: routeItem(redacted, {
          prior,
          capturePresent: !item.capture || !missingByItem.has(item.id),
        }),
      };
    });

  const counts = Object.fromEntries(DESTINATIONS.map((d) => [d, 0]));
  for (const item of items) counts[item.route.destination] += 1;

  return {
    sessionId: bundle.sessionId,
    buildSha: bundle.env?.buildSha ?? null,
    route: bundle.env?.route ?? null,
    items,
    groups: bundle.groups ?? [],
    counts,
    missingCaptures: missing,
    // Nothing has happened yet. Said out loud because a plan that reads like a
    // result is how an automated pipeline starts filing things nobody approved.
    filed: false,
  };
}

/** One line per item, for a person reading a dry run. */
export function renderPlan(plan) {
  const lines = [
    `session ${plan.sessionId} · build ${plan.buildSha ?? "UNKNOWN"} · route ${plan.route ?? "?"}`,
    `${plan.items.length} report(s): ${DESTINATIONS.map((d) => `${plan.counts[d]} ${d}`).join(" · ")}`,
  ];
  for (const item of plan.items) {
    lines.push(
      `  ${item.id} → ${item.route.destination}: ${item.route.reason}` +
        (item.route.warning ? ` [${item.route.warning}]` : ""),
    );
  }
  if (plan.groups.length > 0) {
    lines.push(
      `proposed ${plan.groups.length} PR(s); assembly may split or merge them and will say why`,
    );
  }
  if (plan.missingCaptures.length > 0) {
    lines.push(
      `${plan.missingCaptures.length} report(s) reference an image that is not on disk`,
    );
  }
  return lines.join("\n");
}

/** Prior reports, as `[{ key, text, ref }]`. Absent file = nothing known yet. */
export function readPrior(file) {
  if (!file) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : (parsed.reports ?? []);
  } catch {
    // A missing or unreadable ledger means "nothing known", not "stop": the
    // cost of getting this wrong is a duplicate comment, and the cost of
    // refusing to run is a report nobody sees.
    return [];
  }
}

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
  const source = argOf(argv, "--source");
  if (!source) {
    process.stderr.write(
      "usage: report-intake.mjs --source <dir> [--prior <file>] [--issues [--repo owner/name]] [--out <file>] [--dry-run]\n",
    );
    process.exit(2);
  }
  const result = readBundle(source);
  if (!result.ok) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.exit(1);
  }
  // Both sources feed one list. A ledger entry and an issue are scored by
  // different measures — see `overlapFor` — and each candidate says which it is.
  const prior = [
    ...readPrior(argOf(argv, "--prior")),
    ...(argv.includes("--issues")
      ? openIssuesAsPrior({ repo: argOf(argv, "--repo") ?? null })
      : []),
  ];
  const plan = planIntake(result.bundle, {
    prior,
    // `--source` may be the directory or the bundle file; images are found
    // relative to the directory either way.
    missing: missingCaptures(result.bundle, captureDir(source, result.file)),
  });

  const out = argOf(argv, "--out");
  if (out) writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`${renderPlan(plan)}\n`);
  if (!out) process.stdout.write(`${JSON.stringify(plan)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
