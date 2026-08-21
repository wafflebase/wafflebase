// WHICH PANEL PRODUCED THIS, BY CONTENT — the half of the reviewer's identity that
// neither `config_hash` nor `panel_sha` can express, and the reason two different
// reviewers currently share one cross-run score file.
//
// THE GAP, STATED BY THE CODE ON BOTH SIDES OF IT. `config-hash.mjs`'s header says
// what it deliberately does not cover: "This hashes the LENS COMPOSITION, not the
// panel's code. A new verifier stage or a changed gate leaves the hash identical."
// `store.mjs`'s `byConfigSegment` then keys every cross-run score by
// `(config_hash, corpus_version)`. Put those two facts together and a score computed
// under one panel and a score computed under another land in the SAME FILE, and the
// second overwrites the first with no diagnostic anywhere.
//
// 🔴 AND `putScore` SAID THE OPPOSITE, which is why nothing guarded it: "a score
// computed under a different reviewer lands in a different file by construction".
// That sentence was true of `per-run` scores and false of `cross-run` ones, and it was
// stated as the REASON no check existed. This module is the check; the corrected
// docblock is in the same change.
//
// WHY A CONTENT DIGEST AND NOT A COMMIT SHA. `panel_sha` is recorded already and is
// the right provenance, but it is the wrong IDENTITY: it separates panels that are
// byte-identical. Measured over the live-ingested agent-PR run — 16 item envelopes
// carrying 16 distinct `panel_sha` values, which are 5 distinct panels by content, a
// 3x over-separation. The extreme case is on the record: #830 deleted `scripts/agent`
// entirely and #850 returned it, and the returned file is byte-identical to the
// deleted one. A commit-keyed identity calls that two reviewers and refuses to pool
// runs that cannot differ. `parser_vintage` (decision 49) is already a content hash
// for this exact reason.
//
// WHY THE SET IS DECLARED AND NOT WALKED. The transitive closure of
// `review-panel.mjs`'s local imports is a tempting identity and it is the wrong one:
// measured, it swept 13 modules at the pilot's panel and 17 at `main`, and four of
// the 17 are not the reviewer at all — `gh-checks.mjs`, `guard-verdict.mjs`,
// `command.mjs` and `git-env.mjs` arrive through helpers and would re-partition every
// population on a change to GitHub check-run I/O. A computed set also grows SILENTLY,
// which is the failure `HASHED_LENS_FIELDS` exists to prevent one level down. So the
// set is declared, every local import that is NOT in it carries a written reason in
// `NOT_PANEL_FILES`, and `panel-identity.test.mjs` walks the imports and fails on
// anything classified by neither. A new panel module cannot leave the identity
// quietly; it fails a test until somebody says which side it is on.
//
// 🔴 WHY THE LENSES ARE NOT IN HERE, though a first reading of the problem puts them
// here. Two independent reasons, and the second is the one that would have produced a
// wrong number:
//
//   1. `config_hash` ALREADY covers them, at content level. `HASHED_LENS_FIELDS`
//      includes `rubric_sha256`, which `config-build.mjs` sets to
//      `contentHash(rubricText)` — the sha256 of the lens's own markdown — and
//      `HASHED_CONFIG_FIELDS` covers `lenses.json`'s behaviour-determining fields,
//      with every omission registered in `COSMETIC_CONFIG_FIELDS`. Hashing the lens
//      bytes again here would be a second, weaker source of truth for a fact already
//      recorded correctly, which is precisely the argument `config-hash.mjs`'s header
//      makes when it rejects a hand-maintained `pipeline_version`.
//   2. IT WOULD HASH THE WRONG COPY. A replay's lenses come from the run's frozen
//      config snapshot, materialised into a temp directory (`run.mjs`'s
//      `materializeLenses`), and `--lenses-dir` can point anywhere. The lens files
//      sitting next to `review-panel.mjs` in this checkout are not necessarily the
//      ones the run read, so a digest over them would name a configuration that did
//      not review anything.
//
// So the factorisation is clean and each half is owned once: `config_hash` is the
// CONFIGURATION, `panel_digest` is the CODE, and the reviewer is the pair.
//
// FAIL DIRECTION. Every function here refuses rather than degrading, which is the
// opposite of most read paths in this directory and is deliberate: the outputs are an
// identity and a pooling decision, and a wrong identity is worse than an absent one.
// An unreadable panel file, an empty one, two files sharing a basename, a digest that
// is not `sha256:<64 hex>`, or two panels pooled into one score all throw. The one
// thing that is NOT an error is a record that does not state a digest at all — every
// envelope written before this module existed — and that is answered with the NAMED
// state `PANEL_DIGEST_ABSENT` rather than a blank, because lesson 6 is that "nobody
// recorded this" and "this is the same as that" are different facts.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const refuse = (msg) => {
  throw new Error(`panel identity: ${msg}`);
};

/**
 * Bumped on any change to the digest FUNCTION — the file set, the manifest format or
 * the hash — so a stored digest carries the vintage of the algorithm that produced it.
 *
 * Recorded as PROVENANCE and deliberately NOT hashed, the same decision
 * `CONFIG_HASH_VERSION` argues: a digest computed by @1 and one computed by @2 already
 * differ by construction, so feeding the version in as well would add nothing and
 * would make every future bump look like a panel change.
 */
export const PANEL_DIGEST_VERSION = "wafflebase/panel-digest@1";

/**
 * The digest states that are NOT digests, spelled out rather than left to a falsy
 * value. `store.mjs`'s `panelKeySegment` accepts exactly these two beside a real
 * digest, so each is a directory name a reader can see and neither can collide with a
 * `sha256-` one.
 *
 *   `not-recorded`  no pooled record states a digest. Every envelope written before
 *                   this module existed is in this state, and it is not an error — but
 *                   it is not a safe pooling key either, and saying so in the PATH is
 *                   the only way a reader of `scores/by-config/` can tell.
 *   `mixed`         the pooled records state more than one digest and the operator
 *                   passed the opt-out. The number is real; it is a number about two
 *                   reviewers, and it says so in its own path and its own payload.
 */
export const PANEL_DIGEST_ABSENT = "not-recorded";
export const PANEL_DIGEST_MIXED = "mixed";
export const PANEL_DIGEST_STATES = Object.freeze([PANEL_DIGEST_ABSENT, PANEL_DIGEST_MIXED]);

/**
 * WHERE a recorded `panel_digest` CAME FROM, as a closed vocabulary.
 *
 * The field exists because the three answers are not interchangeable and the difference is
 * not recoverable afterwards. `panel_sha_source` already draws this distinction for the
 * commit (`git` measured, `flag` asserted); this is the same distinction for the digest,
 * with the third value the commit never needed:
 *
 *   `files`          hashed off the panel that was about to run, at run time. The only
 *                    value that is an OBSERVATION.
 *   `reconstructed`  stated rather than observed — computed out of git after the fact by
 *                    `panel-identity.mjs --at <ref>`, or otherwise asserted by an operator
 *                    who knows which panel ran. What `--panel-digest` sets.
 *   `envelopes`      read back off the run and item envelopes a score pools. A score's
 *                    answer, not a run's.
 *
 * 🔴 WHY `reconstructed` IS NOT `files`. The pilot's replays predate this field, so the
 * only way to file their scores under the panel that really produced them is to compute
 * that panel's digest out of git now and state it. That is the right thing to do and it is
 * NOT the same fact as having hashed the files while the panel ran: nobody observed it, and
 * it rests on `panel_sha` being the commit the panel was read from. Recording it as `files`
 * would assert an observation nobody made — the "asserted, not measured" failure
 * `resolvePanelSha` was written to prevent, one field over.
 */
export const PANEL_DIGEST_SOURCES = Object.freeze(["files", "reconstructed", "envelopes"]);

/** The shape a real digest has, checked at every door it passes through. */
const PANEL_DIGEST_TEXT = /^sha256:[0-9a-f]{64}$/;

/** Where the walk in `panel-identity.test.mjs` starts, and the module every file below
 *  is reachable from. Named rather than inlined so the test and the file set cannot
 *  disagree about what "the panel" is rooted at. */
export const PANEL_ENTRY = "review-panel.mjs";

/**
 * WHAT THE PANEL IS, as files, relative to `scripts/agent/`.
 *
 * The test of membership is: does this file decide what the panel FINDS, or which lane
 * a finding lands in? Everything here answers yes, and the reason each one does is
 * worth having written down once.
 *
 * ⚠ ASK THAT QUESTION OF THE DIFF, NOT OF THE FILENAME. Measured between two real panel
 * versions, `severity.mjs` — which owns `BLOCKING` and `normalizeSeverity` and so looks
 * like the behavioural one — changed by +68 lines and touched NEITHER, adding a demotion
 * renderer; `novelty.mjs`, which reads like provenance bookkeeping, changed which findings
 * have a location at all. The names rank these two opposite ways round from the diffs.
 *
 *   `review-panel.mjs`    the orchestrator, the prompts, `routeFinding` and the gate
 *   `severity.mjs`        `classify` / `BLOCKING` / `normalizeSeverity` — which lane
 *   `novelty.mjs`         `noveltyOf` / `DEMOTING_ORIGINS` — the novelty demotion, and
 *                         `findingLocation`, which decides whether a finding HAS a
 *                         location for either provenance gate to judge. Measured
 *                         between two real panel versions: taking the first
 *                         SAME-FILE citation rather than the first citation moved 17
 *                         of 44 blocking findings from no-location to located, 39%
 *   `review-surface.mjs`  `surfaceOfFinding` / `freezeResolves` — the post-freeze
 *                         demotion (#881)
 *   `finding-key.mjs`     the finding identity two findings are merged on
 *   `rounds.mjs`          `findingSimilarity` — whether two wordings are one defect
 *   `rebuttal.mjs`        the adjudicator's schema, prompt and overturn rule
 *   `fix-report.mjs`      `authorClaims` / `claimFor` — which author claims are
 *                         adjudicated at all
 *   `citation.mjs`        `CITATION`, prompt text every lens is sent
 *   `review-state.mjs`    `renderScopeNote`, prompt text, and the state a later round
 *                         reads back
 *
 * Bare basenames because all ten live in one directory today. The digest keys on
 * `path.basename` regardless, so a file that later moves into a subdirectory keeps its
 * identity — see `panelManifest`.
 */
export const PANEL_FILES = Object.freeze([
  "citation.mjs",
  "finding-key.mjs",
  "fix-report.mjs",
  "novelty.mjs",
  "rebuttal.mjs",
  "review-panel.mjs",
  "review-state.mjs",
  "review-surface.mjs",
  "rounds.mjs",
  "severity.mjs",
]);

/**
 * Local imports reachable from `PANEL_ENTRY` that are deliberately NOT the panel, each
 * with the reason it is not.
 *
 * The reason is DATA rather than a comment, exactly as `COSMETIC_CONFIG_FIELDS` makes
 * it data one level down, so the test can require one for every exclusion: a module
 * cannot be dropped out of the reviewer's identity without somebody writing down why.
 *
 * ⚠ Two of these are judgement calls rather than facts, and they are the ones to
 * revisit first if a population ever looks wrongly pooled: `ask.mjs` carries
 * `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, which is prompt text, and `redact.mjs` decides
 * what an infra record says. Both were excluded because they are shared with every
 * other agent script in this directory, so including them would let a change made for
 * the hunt lane re-partition the panel's populations — the over-separation this module
 * exists to avoid, in a second form.
 */
export const NOT_PANEL_FILES = Object.freeze({
  "ask.mjs":
    "the model-call transport, shared by every agent script here. The parameters it is called with (model, effort, samples, maxTurns) are hashed by config_hash and the SDK build behind it is recorded as sdk_version, so what it contributes to a review is identified twice already",
  "token-pool.mjs":
    "credential slot accounting. It decides how many calls run at once and which secret each uses; it cannot change what any of them answers",
  "redact.mjs":
    "removes secrets from text on its way out to a human. It rewrites what a reader sees, never which findings exist or which lane they are in",
  "gh-checks.mjs":
    "GitHub check-run and argv I/O. Reached through review-surface.mjs; a change to how a check run is written does not change what the panel found",
  "guard-verdict.mjs":
    "reads and writes the round guard's verdict file. Reached through rebuttal.mjs, and it is the WORKFLOW's record of a round rather than an input to any finding",
  "command.mjs":
    "a child-process helper. Reached through rounds.mjs, and it is I/O plumbing with no view of a finding",
  "git-env.mjs":
    "scopes git invocations to a repository root. Reached through novelty.mjs and review-surface.mjs; it decides which checkout is read, which is the RUN's identity (panel_sha, review_commit) and not the panel's",
});

/**
 * A panel file's basename must be a plain filename, because it becomes a KEY in the
 * hashed manifest and lines there are newline-separated and space-delimited. A name
 * carrying either would let two file sets produce one manifest, which is a digest
 * collision built by hand. Same character class as `store.mjs`'s `SEGMENT`, for the
 * same reason and by the same argument.
 */
const PANEL_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The exact bytes `panelDigest` hashes — one `<basename> <sha256 of contents>` line
 * per file, sorted by basename.
 *
 * Exported because it is the ANSWER TO "WHICH FILE MOVED", and a digest that can only
 * say "different" is a digest nobody can act on. The one-time backfill CLI at the
 * bottom of this file prints it, so an operator comparing two panels reads the file
 * that differs rather than two 64-character strings.
 *
 * SORTED BY BASENAME, CONTENT INCLUDED, PATH DISCARDED — every part of that is a
 * decision:
 *
 *   sorted           the digest must not depend on declaration order, or a tidy-up of
 *                    `PANEL_FILES` would look like a new reviewer
 *   by basename      `scripts/agent` was deleted (#830) and returned (#850). A
 *                    path-keyed digest calls a moved-and-restored tree two panels; a
 *                    basename-keyed one calls byte-identical files one panel, which is
 *                    what they are
 *   content hashed   so this stays a fixed-size string over a 3400-line file, and so
 *                    the per-file value is comparable on its own
 *
 * 🔴 DUPLICATE BASENAMES ARE REFUSED. Two files with one basename would silently
 * collapse into a single manifest line, so one panel file's contents would stop
 * affecting the identity altogether — the exact "quietly wrong digest" this module has
 * to make impossible. It cannot happen with today's flat set, and the check is what
 * keeps that true the day a subdirectory appears.
 */
export function panelManifest(files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    refuse("a digest needs at least one file — a digest over nothing is the same value for every panel");
  }
  const byName = new Map();
  for (const f of list) {
    const name = path.basename(String(f?.name ?? ""));
    if (!PANEL_FILE_NAME.test(name)) {
      refuse(`panel file name must match ${PANEL_FILE_NAME.source}, got ${JSON.stringify(f?.name)}`);
    }
    // 🔴 A FILE THAT IS NOT THERE IS A NAMED STATE, and it has to be, because the panel's
    // FILE SET changes and not only its contents. Measured: `review-surface.mjs` — the
    // post-freeze demotion #881 added — does not exist at the pilot's panel commit
    // `46da673dd`, so the pilot's panel is a different SHAPE, not merely different bytes.
    // `absent` cannot collide with any content, which is 64 hex characters, so a panel
    // missing a file and a panel containing any version of it are never one digest. Only
    // `readPanelFiles`' explicit opt-in produces this; a missing file on the RUN path
    // still refuses (see there).
    if (f?.absent === true) {
      if (byName.has(name)) refuse(`two panel files share the basename ${JSON.stringify(name)}`);
      byName.set(name, null);
      continue;
    }
    if (typeof f?.content !== "string" || f.content === "") {
      refuse(
        `panel file ${name} has no contents — an empty read is what a missing file looks like, and hashing it would ` +
          "record a panel that never existed",
      );
    }
    if (byName.has(name)) {
      refuse(
        `two panel files share the basename ${JSON.stringify(name)} — the digest is keyed by basename, so one would ` +
          "silently replace the other and its contents would stop identifying the panel",
      );
    }
    byName.set(name, f.content);
  }
  return [...byName.keys()].sort().map((name) => `${name} ${byName.get(name) === null ? "absent" : sha256(byName.get(name))}\n`).join("");
}

/**
 * The panel's content identity: `sha256:<64 hex>` over `panelManifest`.
 *
 * `sha256:` prefixed to match `config_hash` exactly, so the two halves of the reviewer
 * pair look alike in a store, in a report and in a path — and so `panelKeySegment` can
 * reuse the injective `:` → `-` mangle `configHashSegment` already argues for.
 */
export function panelDigest(files) {
  return `sha256:${sha256(panelManifest(files))}`;
}

/** Whether a value is a real digest, as opposed to one of the named states or junk. */
export function isPanelDigest(value) {
  return PANEL_DIGEST_TEXT.test(String(value ?? ""));
}

/**
 * `PANEL_FILES` with their contents, through an INJECTED reader.
 *
 * The reader is a parameter because the two callers read from different places and
 * neither should be the other's special case: `run.mjs` reads this checkout's files off
 * disk, and the backfill CLI reads a past panel out of git. A test needs neither.
 *
 * A file that is missing, unreadable or empty REFUSES. This is the fail direction the
 * module's header argues for, and it is also the concrete guard against the thing that
 * actually happened here: `scripts/agent` was deleted for two commits, and a reader
 * that degraded a missing file to `""` would have produced a confident digest for a
 * panel that was not there.
 */
export function readPanelFiles({ read, files = PANEL_FILES, allowAbsent = false } = {}) {
  if (typeof read !== "function") refuse("readPanelFiles needs a read(relativePath) function — it does no I/O of its own");
  return files.map((rel) => {
    let content;
    try {
      content = read(rel);
    } catch (e) {
      // `allowAbsent` is the BACKFILL's opt-in and nothing else's. A panel that predates
      // one of today's declared files really is missing it, and the operator tool has to
      // be able to say which — but on the run path a read that fails is a broken checkout,
      // and a confident digest over it is the failure this module exists to prevent.
      if (allowAbsent) return { name: path.basename(rel), absent: true, why: e.message.split("\n")[0] };
      refuse(`panel file ${rel} could not be read (${e.message}) — a digest over a partial panel names a reviewer that never ran`);
    }
    if (typeof content !== "string" || content.trim() === "") {
      refuse(`panel file ${rel} read back empty — see readPanelFiles: an empty read is indistinguishable from a missing file`);
    }
    return { name: path.basename(rel), content };
  });
}

/** This checkout's panel digest, off the filesystem. `agentDir` defaults to the
 *  `scripts/agent` this file sits under, which is the panel `run.mjs` spawns by
 *  default — see `DEFAULT_PANEL_SCRIPT`. */
export function panelDigestOf(agentDir = path.join(HERE, "..")) {
  return panelDigest(readPanelFiles({ read: (rel) => readFileSync(path.join(agentDir, rel), "utf8") }));
}

/**
 * Every local relative import in one module's source, as written.
 *
 * A REGEX AND NOT A PARSE, on purpose: the module's header rejects a clever file set,
 * and the same argument applies to how the set is CHECKED. What this feeds is an
 * assertion that every import is classified, so its only failure directions are a
 * missed import (which the test would then not demand a classification for) and a
 * false one (which fails loudly until somebody names it). Both are visible; neither
 * silently changes an identity.
 *
 * Three forms, because all three appear in this directory: `import … from "./x.mjs"`,
 * the bare side-effect `import "./x.mjs"`, and `export … from "./x.mjs"` — which
 * `review-panel.mjs` really does use (`export { classifyResult } from "./ask.mjs"`),
 * and which a from-only pattern would have missed.
 */
export function localImportsOf(source) {
  const text = String(source ?? "");
  const found = new Set();
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.[^"']+)["']/g,
    /(?:^|\n)\s*import\s*["'](\.[^"']+)["']/g,
    /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * How many records state each panel digest, as a sorted tally.
 *
 * `records` are `{id, panelDigest}` — run envelopes, item envelopes, or both; this does
 * not care which, because "the panel disagrees between two runs" and "it disagrees
 * between two items of one run" are the same defect and must produce the same refusal.
 *
 * A record stating nothing lands in the `not-recorded` bucket rather than being
 * dropped. That is the whole point: sixteen items of which fifteen state a digest and
 * one does not is a MIXTURE, and silently ignoring the silent one would pool it under
 * the other fifteen's identity — which is the bug, with an extra step.
 *
 * Ordered by count descending, then digest ascending, so the refusal message reads
 * with the dominant panel first and is stable between runs.
 */
export function tallyPanelDigests(records) {
  const byDigest = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    const raw = r?.panelDigest;
    // ABSENT IS EXACTLY THREE VALUES, and the width of that definition is load-bearing.
    // An earlier version read "not a non-empty string" as absent, which quietly bucketed
    // a `panel_digest` of `7` — malformed, recoverable only by someone noticing — in with
    // the envelopes that predate the field. A field that is present and wrong is a
    // different fact from a field that is not there, and the refusal below is what
    // separates them.
    const absent = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    const stated = absent ? PANEL_DIGEST_ABSENT : typeof raw === "string" ? raw.trim() : raw;
    if (!isPanelDigest(stated) && !PANEL_DIGEST_STATES.includes(stated)) {
      refuse(
        `record ${JSON.stringify(r?.id ?? "(unnamed)")} states panel_digest ${JSON.stringify(raw)}, which is neither ` +
          `sha256:<64 hex> nor one of ${PANEL_DIGEST_STATES.join(" | ")} — it is refused at the same door config_hash is`,
      );
    }
    if (!byDigest.has(stated)) byDigest.set(stated, []);
    byDigest.get(stated).push(String(r?.id ?? "(unnamed)"));
  }
  return [...byDigest.entries()]
    .map(([digest, ids]) => ({ digest, items: ids.length, ids: [...ids].sort() }))
    .sort((a, b) => b.items - a.items || a.digest.localeCompare(b.digest));
}

/**
 * The one panel digest a `cross-run` score may be filed under — or a refusal naming
 * every panel it would have pooled.
 *
 * 🔴 THIS IS THE GUARANTEE `putScore`'S DOCBLOCK USED TO ASSERT. A cross-run score is
 * one number over K runs, and until now nothing anywhere checked that those runs ran
 * the same panel. The live case is not hypothetical: one ingested run pools 16 items
 * across 5 panels by content, and exactly one of those items ran a panel carrying the
 * post-freeze demotion (#881) that decides whether a finding gates. That is one score
 * spanning two different answers to a gating question, and nothing said so.
 *
 * THE OPT-OUT IS EXPLICIT AND DOES NOT DEFAULT ON. `allowMixed` is what an operator
 * passes to say "I know, file it anyway" — the mixed run needs it to produce anything
 * at all, and making them say it out loud is the point. What comes back is
 * `PANEL_DIGEST_MIXED` plus the full tally, so the caller stamps both into the payload
 * and the number can never be read afterwards as a single reviewer's.
 *
 * NEVER PICKS THE FIRST. There is no majority rule and no most-common-wins here: 15
 * items on one panel and 1 on another is still two panels, and a rule that resolved it
 * would be a rule for hiding it.
 *
 * 🔴 `stated` — AN OPERATOR'S `--panel-digest` — IS CHECKED AGAINST THE RECORDS, NOT
 * SUBSTITUTED FOR THEM. It exists for exactly one situation: runs that recorded no digest,
 * where computing the panel out of git afterwards is the only way to attribute their scores
 * at all. Anything else and it is an assertion overriding a measurement, and the worst case
 * is the one this whole module is for — a pool that really does span two panels, silently
 * filed under one because someone passed a flag. So a stated digest is honoured only when
 * every record resolves to `not-recorded`, and refused otherwise with what the records
 * actually say. It is resolved HERE and not at the two call sites, because two copies of
 * this rule is how the second one comes to be more permissive than the first.
 */
export function resolvePanelDigest({ records, allowMixed = false, stated = null } = {}) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) {
    refuse("a cross-run score must name the records it pools — with none, 'they all ran the same panel' is unfalsifiable");
  }
  const tally = tallyPanelDigests(list);
  if (stated !== null && stated !== undefined && stated !== "") {
    if (!isPanelDigest(stated)) {
      refuse(`a stated panel digest must be sha256:<64 hex>, got ${JSON.stringify(stated)} — the named states are what a resolution lands in, not something to assert`);
    }
    if (!(tally.length === 1 && tally[0].digest === PANEL_DIGEST_ABSENT)) {
      refuse(
        `a panel digest was stated (${stated}) but the ${list.length} pooled record(s) already say ` +
          `${tally.map((t) => `${t.digest} × ${t.items}`).join(", ")} — a stated digest may only fill in for records that ` +
          "recorded none, never override what they recorded. Drop the flag to use what they say" +
          (tally.length > 1 ? ", and score each panel separately or pass the mixed-panel opt-out" : ""),
      );
    }
    return { digest: stated, mixed: false, tally, source: "reconstructed" };
  }
  // `envelopes` on every path out of here: this function's whole input is stored records,
  // so whatever it answers was read rather than asserted. A caller that instead STATES a
  // digest does not come through here at all, and stamps `reconstructed`.
  const source = "envelopes";
  if (tally.length === 1) return { digest: tally[0].digest, mixed: false, tally, source };
  const detail = tally.map((t) => `${t.digest} × ${t.items}`).join(", ");
  if (!allowMixed) {
    refuse(
      `the ${list.length} pooled record(s) state ${tally.length} panel digests (${detail}) — one cross-run score over ` +
        "two panels is one number for two reviewers, and the file it lands in can only name one of them. Score each " +
        "panel separately, or pass the mixed-panel opt-out to file it as `mixed` with the mixture stamped into the payload",
    );
  }
  return { digest: PANEL_DIGEST_MIXED, mixed: true, tally, source };
}

// --- the one-time backfill CLI ----------------------------------------------
//
// 🔴 AN OPERATOR TOOL, NOT A SCORING PATH, and the distinction is load-bearing. A
// scorer must never derive a digest from git: a historical panel is not reachable from
// a CI checkout (`wafflebase` squash-merges, so a PR head is only reachable while a
// `refs/eval/*` ref holds it), and a recomputed identity changes when history is
// rewritten. Every digest a score is keyed by comes from a RECORDED `panel_digest` in
// an envelope. This exists so a human can read the digest of a panel that ran before
// the field existed, and decide what to do about the scores already filed under it.

const USAGE =
  "usage: panel-identity.mjs [--at <git-ref>] [--prefix <path>] [--dir <scripts/agent>]\n" +
  "\n" +
  "Prints the panel manifest (one file per line, with its content hash) and the\n" +
  "resulting panel_digest. With no arguments it reads this checkout off disk.\n" +
  "\n" +
  "--at reads the files out of git instead, for a panel that ran before panel_digest\n" +
  "existed: `--at 46da673dd`. --prefix is where scripts/agent lived in that tree\n" +
  "(default scripts/agent/), because it has not always been in the same place.\n" +
  "--allow-absent hashes a declared file that does not exist there as `absent` and says\n" +
  "which. An older panel can have a different file SET, not just different bytes.\n" +
  "\n" +
  "This is an OPERATOR tool. Nothing that computes a score may derive a digest this\n" +
  "way — a score is keyed by the panel_digest RECORDED in its run's envelopes.";

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const at = flag("at");
  const prefix = flag("prefix") ?? "scripts/agent/";
  const allowAbsent = argv.includes("--allow-absent");
  const files = at
    ? readPanelFiles({ allowAbsent, read: (rel) => execFileSync("git", ["show", `${at}:${prefix}${rel}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) })
    : readPanelFiles({ allowAbsent, read: (rel) => readFileSync(path.join(flag("dir") ?? path.join(HERE, ".."), rel), "utf8") });
  process.stdout.write(panelManifest(files));
  // NAMED on stderr as well as in the manifest. A digest quietly computed over nine of
  // ten declared files is exactly the "quietly wrong identity" this module may not have,
  // so the operator reads which files the panel did not have before using the number.
  const absent = files.filter((f) => f.absent);
  if (absent.length > 0) {
    console.error(`\n⚠ ${absent.length} of ${files.length} declared panel file(s) DO NOT EXIST in this source, and are hashed as absent:`);
    for (const f of absent) console.error(`    ${f.name} — ${f.why}`);
  }
  console.log(`\npanel_digest ${panelDigest(files)}`);
  console.log(`panel_digest_version ${PANEL_DIGEST_VERSION}`);
  console.log(`source ${at ? `git ${at}:${prefix}` : flag("dir") ?? path.join(HERE, "..")}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
