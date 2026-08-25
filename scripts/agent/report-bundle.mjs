// Read a debug-report bundle off disk, and refuse it if the pipeline cannot act
// on it.
//
// FAIL-CLOSED, and this is the boundary that matters most: everything downstream
// can create commits and open pull requests, so a bundle only partly understood
// is one that must not be acted on. A dropped field here is not a cosmetic loss;
// it is a PR opened for a reason nobody stated.
//
// WHY THIS IS NOT `parseBundle` FROM THE PACKAGE. `scripts/agent/` is a separate
// npm install outside the pnpm workspace (see `harness-engineering.md` on why the
// UI hunter's runner is a subprocess), so the TypeScript package's parser cannot
// be imported here. This validator is therefore deliberately NARROWER: it checks
// exactly what the pipeline reads, and nothing else.
//
// The two are kept from drifting by a SHARED FIXTURE rather than by hope:
// `fixtures/bundle-valid.json` and `fixtures/bundle-invalid/*.json` are read by
// this file's test suite AND by the package's, so a rule that changes on one side
// and not the other turns red immediately.
//
// Usage:
//   node report-bundle.mjs <dir-or-file>          # print the parsed bundle
//   node report-bundle.mjs <dir-or-file> --check  # exit 0 valid, 1 invalid

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The only schema version this pipeline knows how to act on. */
export const BUNDLE_SCHEMA = 1;

export const DISPOSITIONS = ["verify", "publish", "discard"];

export const CHANGE_KINDS = [
  "spacing",
  "color",
  "token",
  "copy",
  "a11y",
  "affordance",
  "layout",
  "logic",
];

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Validate a parsed bundle.
 *
 * Returns `{ ok, bundle }` or `{ ok: false, errors }` with EVERY problem listed,
 * not just the first: one rejection naming every fault is what makes a version
 * skew debuggable, where a parser that stops at the first field turns it into a
 * sequence of single-field mysteries.
 */
export function validateBundle(input) {
  const errors = [];
  const bad = (path, why) => errors.push(`${path}: ${why}`);

  if (!isRecord(input)) return { ok: false, errors: ["bundle: expected an object"] };
  // Version first: on a mismatch, every other message is noise about fields that
  // legitimately moved.
  if (input.schema !== BUNDLE_SCHEMA) {
    return {
      ok: false,
      errors: [`bundle.schema: expected ${BUNDLE_SCHEMA}, got ${JSON.stringify(input.schema)}`],
    };
  }
  if (!isNonEmptyString(input.sessionId)) bad("bundle.sessionId", "expected a non-empty string");
  if (!isFiniteNumber(input.createdAt)) bad("bundle.createdAt", "expected a finite number");

  if (!isRecord(input.env)) {
    bad("bundle.env", "expected an object");
  } else {
    if (typeof input.env.route !== "string") bad("bundle.env.route", "expected a string");
    // `buildSha` may be absent — a reporter on an unstamped build still deserves
    // to be heard — but the pipeline has to KNOW it is absent rather than
    // assume a version, so the field is optional and never defaulted.
    if (input.env.buildSha !== undefined && !isNonEmptyString(input.env.buildSha)) {
      bad("bundle.env.buildSha", "expected a non-empty string when present");
    }
  }

  if (!Array.isArray(input.items)) {
    bad("bundle.items", "expected an array");
    return { ok: false, errors };
  }
  if (input.items.length === 0) bad("bundle.items", "expected at least one item");

  const ids = new Set();
  input.items.forEach((item, i) => {
    const at = `bundle.items[${i}]`;
    if (!isRecord(item)) return bad(at, "expected an object");
    if (!isNonEmptyString(item.id)) bad(`${at}.id`, "expected a non-empty string");
    else if (ids.has(item.id)) bad(`${at}.id`, `duplicate item id ${item.id}`);
    else ids.add(item.id);
    // The note is the one thing an item cannot be missing: it is what the
    // reporter said, and for an appearance report it is the ground truth the
    // `visual-intent` lens judges against. An item without it has nothing to
    // verify and nothing to write an issue from.
    if (!isNonEmptyString(item.note)) bad(`${at}.note`, "expected a non-empty string");
    if (!DISPOSITIONS.includes(item.disposition)) {
      bad(`${at}.disposition`, `expected one of ${DISPOSITIONS.join(" | ")}`);
    }
    if (typeof item.agentCandidate !== "boolean") {
      bad(`${at}.agentCandidate`, "expected a boolean");
    }
    if (!isRecord(item.target) || typeof item.target.kind !== "string") {
      bad(`${at}.target`, "expected an object with a kind");
    }
    if (item.draft !== undefined) {
      if (!isRecord(item.draft)) bad(`${at}.draft`, "expected an object");
      else {
        if (!isNonEmptyString(item.draft.title)) {
          bad(`${at}.draft.title`, "expected a non-empty string");
        }
        if (!CHANGE_KINDS.includes(item.draft.kind)) {
          bad(`${at}.draft.kind`, `expected one of ${CHANGE_KINDS.join(" | ")}`);
        }
      }
    }
  });

  if (input.groups !== undefined) {
    if (!Array.isArray(input.groups)) {
      bad("bundle.groups", "expected an array");
    } else {
      const claimed = new Set();
      const groupIds = new Set();
      input.groups.forEach((group, i) => {
        const at = `bundle.groups[${i}]`;
        if (!isRecord(group)) return bad(at, "expected an object");
        if (!isNonEmptyString(group.id)) bad(`${at}.id`, "expected a non-empty string");
        else if (groupIds.has(group.id)) bad(`${at}.id`, `duplicate group id ${group.id}`);
        else groupIds.add(group.id);
        if (!CHANGE_KINDS.includes(group.kind)) {
          bad(`${at}.kind`, `expected one of ${CHANGE_KINDS.join(" | ")}`);
        }
        // The package's `parseBundle` requires this and this validator did not,
        // so a bundle from any non-browser producer passed here and then killed
        // PR assembly on `group.prTitle.slice` — the exact drift the shared
        // fixtures exist to prevent, in a field no fixture covered.
        if (!isNonEmptyString(group.prTitle)) {
          bad(`${at}.prTitle`, "expected a non-empty string");
        }
        if (!Array.isArray(group.itemIds) || group.itemIds.length === 0) {
          return bad(`${at}.itemIds`, "expected a non-empty array");
        }
        for (const id of group.itemIds) {
          // A group naming an item that is not in the bundle describes a PR the
          // pipeline cannot build. Rejected rather than trimmed: silently
          // dropping the reference would open a PR the reporter did not approve,
          // which is the failure the delta reporting exists to prevent.
          if (!ids.has(id)) bad(`${at}.itemIds`, `no such item ${id}`);
          else if (claimed.has(id)) bad(`${at}.itemIds`, `item ${id} is already in another group`);
          else claimed.add(id);
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, bundle: input };
}

/**
 * The bundle file inside a report directory, or the file itself.
 *
 * ONE SESSION CAN HAND OVER MORE THAN ONCE, so a directory holds
 * `bundle.json`, `bundle-2.json`, … — the endpoint refuses to overwrite an
 * earlier batch. The NEWEST is the one intake takes: the reporter just sent it,
 * and the earlier ones have already been through here.
 *
 * Sorted numerically, not lexically: `bundle-10.json` sorts before
 * `bundle-2.json` as a string, so a tenth handover would have been read as the
 * oldest.
 */
export function bundlePaths(target) {
  if (!existsSync(target)) return [];
  if (!statSync(target).isDirectory()) return [target];
  const seq = (name) => (name === "bundle.json" ? 1 : Number(name.slice(7, -5)));
  return readdirSync(target)
    .filter((name) => /^bundle(-\d+)?\.json$/.test(name))
    .sort((a, b) => seq(b) - seq(a))
    .map((name) => path.join(target, name));
}

/** The bundle intake acts on: the newest handover in the directory. */
export function bundlePath(target) {
  return bundlePaths(target)[0] ?? null;
}

/**
 * The directory a bundle's images live in.
 *
 * Both entry points accept a DIRECTORY OR THE BUNDLE FILE, and `captureFiles`
 * only reads a directory — so passing the file through unchanged made every
 * capture report as missing, and every appearance route carry "no image on disk"
 * for images that were right there. Exported so the two callers cannot drift.
 */
export function captureDir(target, bundleFile) {
  if (existsSync(target) && statSync(target).isDirectory()) return target;
  return path.dirname(bundleFile ?? target);
}

/** Read and validate. `{ ok: false }` carries a reason a human can act on. */
export function readBundle(target) {
  const file = bundlePath(target);
  if (!file) return { ok: false, errors: [`no bundle*.json at ${target}`] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return { ok: false, errors: [`${file}: not valid JSON (${err.message})`] };
  }
  const result = validateBundle(parsed);
  return result.ok ? { ...result, file } : result;
}

/**
 * The capture files sitting next to a bundle, by capture id.
 *
 * Read from the DIRECTORY rather than trusted from the bundle: the bundle says
 * which images should be there, and the difference between that and what is
 * actually on disk is something the pipeline has to be able to report.
 */
export function captureFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return {};
  const out = {};
  for (const name of readdirSync(dir)) {
    const match = /^(.+)\.(png|jpg|jpeg|webp)$/i.exec(name);
    if (match) out[match[1]] = path.join(dir, name);
  }
  return out;
}

/** Items the bundle promised an image for that is not on disk. */
export function missingCaptures(bundle, dir) {
  const present = captureFiles(dir);
  return bundle.items
    .filter((item) => item.capture && !present[item.capture.id])
    .map((item) => ({ id: item.id, note: item.note, capture: item.capture.id }));
}

function main(argv) {
  const target = argv[0];
  if (!target) {
    process.stderr.write("usage: report-bundle.mjs <dir-or-file> [--check]\n");
    process.exit(2);
  }
  const result = readBundle(target);
  if (!result.ok) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.exit(1);
  }
  if (argv.includes("--check")) {
    const dir = captureDir(target, result.file);
    const missing = missingCaptures(result.bundle, dir);
    if (missing.length > 0) {
      process.stderr.write(
        `${missing.length} item(s) reference an image that is not on disk: ${missing
          .map((m) => m.capture)
          .join(", ")}\n`,
      );
    }
    process.stdout.write(`ok: ${result.bundle.items.length} item(s)\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result.bundle, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
