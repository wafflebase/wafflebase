/**
 * One line naming why a lane failed, for `.harness-reports/<lane>.json` and the
 * job summary `ci-report.yml` renders from it.
 *
 * WHY THIS IS NOT A GREP. The previous version returned the FIRST line anywhere
 * in the lane's output matching `/\b(FAIL|ERROR|error|Error|✗|✘|FAILED)\b/`. That
 * is right only by accident, and two real runs show both ways it goes wrong:
 *
 *   - #758's `agent:tests` reported `classifyResult: distinguishes verdict /
 *     api-error / no-output at its new home` — a test that PASSED (`ok 29`),
 *     matched on `api-error` inside its own NAME, 2,600 lines before the real
 *     failure. Every `agent:tests` failure since #578 carried a wrong summary,
 *     because a suite that tests error handling always has "error" in some
 *     passing test's name.
 *   - Run 31658161586's `verify:entropy` reported a NestJS `WARN` line —
 *     `detach failed for doc-1: Error: detach failed` — a fixture deliberately
 *     logging a handled error, ~700 lines before anything failed.
 *
 * Both are the same defect: guessing from the whole log instead of reading the
 * structure the tool already emits. So this reads TAP when TAP is there, and
 * otherwise falls back to the old scan with the one class of line that is never
 * a failure removed.
 *
 * Extracted from `verify-self.mjs` so it can be tested at all: importing that
 * module RUNS the suite, which is why `--print-lanes` exists rather than an
 * export. `scripts/test/` is run by the `scripts:tests` lane.
 */

const MAX = 500;

/**
 * `node --test` has TWO reporters and picks between them on its own: `tap` when
 * stdout is a pipe, `spec` when it is a TTY — and which one you get has ALSO
 * moved between Node majors. CI captures the lane through a pipe and sees TAP;
 * the same command on a developer's terminal, and on Node 24 here, prints spec.
 * Both are parsed, because a summary that is correct only under the reporter CI
 * happens to choose today is the same fragility this function is replacing.
 *
 * The spec marker is U+2716 `✖`, which is NOT one of the `✗` U+2717 / `✘` U+2718
 * the loose pattern below knows — so before this, a spec-formatted failure fell
 * through to the scan and matched `error` in some PASSING test's name instead.
 * Measured end to end, not reasoned about.
 */

/** `node --test`'s TAP: the failing test, and the YAML block under it. */
const NOT_OK = /^\s*not ok \d+ - (.+)$/;
/** Anchored at line start so `# Subtest: not ok …` in a NAME cannot match. */
const YAML_ERROR = /^\s*error:\s*(.+)$/;
/**
 * A YAML BLOCK SCALAR header — `error: |-` — which is what node emits whenever
 * the message has more than one line, and an assertion message usually does.
 * Taking the captured group literally there yields the summary `… — |-`, which
 * is how this was caught: the end-to-end run printed exactly that.
 */
const BLOCK_SCALAR = /^[|>][-+]?$/;
/**
 * A log LEVEL, which marks a line as something the run printed on its way past a
 * problem it handled — never the reason a lane exited non-zero. Uppercase and
 * whole-word on purpose: it must match Nest's `  WARN  ` column and not the word
 * "warns" in a test name.
 */
const LOG_LEVEL = /\b(WARN|WARNING|INFO|DEBUG|TRACE|NOTICE)\b/;
/**
 * The spec reporter's failure line. The trailing duration is REQUIRED: without
 * it this also matches the section header `✖ failing tests:`, which would report
 * the literal string "failing tests" as the failure.
 */
const SPEC_FAIL = /^\s*✖ (.+?) \(\d+(?:\.\d+)?m?s\)\s*$/;
/** An indented `AssertionError: …` / `TypeError: …` under a spec failure. */
const SPEC_DETAIL = /^\s+([A-Za-z]*Error\b.*)$/;
/**
 * The last-resort scan. The word markers keep their boundaries so `error` does
 * not match inside `terror`; the tick marks CANNOT have them, because `\b` is a
 * transition between a word and a non-word character and `✗` is not a word
 * character — so `/\b✗\b/` never matches a line that STARTS with one, which is
 * every line a reporter draws them on. The original had `✗` and `✘` inside the
 * boundaries and they were therefore dead: a vitest failure line fell through to
 * the last line of the lane's output instead, usually `ELIFECYCLE`.
 */
const LOOSE = /\b(FAIL|ERROR|error|Error|FAILED)\b|[✗✘✖]/;

const clean = (s) => s.trim().slice(0, MAX);

/**
 * @param {string} output combined stdout+stderr of one lane
 * @returns {string | null}
 */
export function extractFailureSummary(output) {
  const raw = String(output ?? "").split("\n");

  // 1. TAP, when the lane emitted any. `node --test` names the failing test and
  //    says why, so there is nothing to infer.
  for (let i = 0; i < raw.length; i += 1) {
    const failed = NOT_OK.exec(raw[i]);
    if (failed === null) continue;
    const name = failed[1].trim();
    // The YAML block belongs to THIS result, so the search is bounded: an
    // unbounded one would attach the next failure's `error:` to this name. 12
    // lines covers `duration_ms`/`type`/`location`/`failureType`/`error`.
    for (let j = i + 1; j < Math.min(i + 13, raw.length); j += 1) {
      if (/^\s*\.\.\.\s*$/.test(raw[j])) break; // end of the YAML block
      const detail = YAML_ERROR.exec(raw[j]);
      if (detail === null) continue;
      const value = detail[1].trim();
      if (!BLOCK_SCALAR.test(value)) {
        return clean(`${name} — ${value.replace(/^['"]|['"]$/g, "")}`);
      }
      // The message is the indented text under the header; its first non-empty
      // line is the part worth one line of a summary.
      for (let k = j + 1; k < Math.min(j + 6, raw.length); k += 1) {
        if (raw[k].trim().length > 0) return clean(`${name} — ${raw[k].trim()}`);
      }
      return clean(name);
    }
    return clean(name);
  }

  // 2. The spec reporter, for the same `node --test` lanes under a different
  //    format. The name comes from the first failure; the reason, when there is
  //    one, comes from the `✖ failing tests:` block that repeats it further down.
  for (let i = 0; i < raw.length; i += 1) {
    const failed = SPEC_FAIL.exec(raw[i]);
    if (failed === null) continue;
    const name = failed[1].trim();
    for (let j = i; j < raw.length; j += 1) {
      const repeat = SPEC_FAIL.exec(raw[j]);
      if (repeat === null || repeat[1].trim() !== name) continue;
      for (let k = j + 1; k < Math.min(j + 5, raw.length); k += 1) {
        const detail = SPEC_DETAIL.exec(raw[k]);
        if (detail !== null) return clean(`${name} — ${detail[1].trim()}`);
      }
    }
    return clean(name);
  }

  // 3. No structured output — a vitest, tsc, vite or knip lane. Same scan as before, minus the
  //    lines a log level marks as noise. Kept as a heuristic deliberately: the
  //    honest fix for these is to read each tool's own format, and inventing that
  //    without a real failing sample per tool is how a reporting change starts
  //    reporting something new and equally wrong.
  const lines = raw.filter((l) => l.trim().length > 0);
  for (const line of lines) {
    if (LOG_LEVEL.test(line)) continue;
    if (LOOSE.test(line) && line.trim().length > 5) return clean(line);
  }

  // 4. Nothing matched. The last line is usually the exit message.
  return lines.length > 0 ? clean(lines[lines.length - 1]) : null;
}
