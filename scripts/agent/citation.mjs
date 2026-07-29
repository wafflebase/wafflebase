// What counts as evidence that LOCATES something: a `path.ext:line` citation.
//
// Its own module because two callers need the SAME answer and a drifted second
// copy would silently disagree about what evidence is:
//   - `isDroppingVerdict` (review-panel.mjs) — a verifier may only DROP a finding
//     when it cites a location it actually read.
//   - `findingLocation` (novelty.mjs) — needs a file:line to ask git how that
//     code got there; a finding it cannot locate is `unknown`, i.e. still blocking.
//
// It cannot live in either consumer: review-panel.mjs imports novelty.mjs, so a
// definition in novelty.mjs that review-panel.mjs also imported would be fine,
// but the reverse (novelty importing review-panel) is a cycle. A leaf module has
// neither problem.

/**
 * A citation must locate something: `path.ext:line`, anywhere in the string.
 *
 * No `g` flag, so `.test`/`.exec` carry no `lastIndex` state between callers —
 * with three importers sharing one regex object, a `g` flag would make the
 * result depend on who called it last.
 */
export const CITATION = /[^\s:]+\.[A-Za-z0-9_]+:\d+/;

/**
 * Pull the `{file, line}` out of the first citation in a string, or `null`.
 *
 * Returns null — never throws, never guesses — on anything that does not locate
 * a line. That includes a bare filename with no line number, which is rejected
 * deliberately: every consumer treats "no location" as the conservative outcome
 * (keep the finding / cannot judge novelty), so a lenient parse here would buy
 * nothing and cost precision. `line` is returned as a Number and is always >= 1,
 * because `\d+` cannot match a negative and a `:0` citation locates nothing.
 */
export function parseCitation(text) {
  if (typeof text !== "string") return null;
  const m = CITATION.exec(text);
  if (!m) return null;
  const at = m[0].lastIndexOf(":");
  const file = m[0].slice(0, at);
  const line = Number(m[0].slice(at + 1));
  if (!Number.isInteger(line) || line < 1) return null;
  return { file, line };
}
