/**
 * Collaborator display names — the blame gutter's per-line label and the peer
 * caret's name tag — are SELF-REPORTED. Both come from the same place: a
 * client's own Yorkie presence, either directly (`getPeerSelections()`) or
 * copied into a `root.content` run attribute when it writes text
 * (`getAuthorSpans()`). Nothing on the way validates them — Yorkie validates
 * nothing inside a change, and the backend never sees a note edit at all.
 *
 * So a name is sanitized HERE, at the boundary where it becomes DOM, rather
 * than inside one store implementation: both render paths (gutter label, caret
 * label) and both stores (`MemNoteStore`, `YorkieNoteStore`) then carry the
 * same guarantee, and a store that forgot to strip cannot put control or
 * bidi-override characters on screen.
 */

/**
 * Names are capped here rather than elided by CSS alone: the caret label has no
 * width limit of its own, so an unbounded name would paint across the editor.
 */
export const MAX_DISPLAY_NAME_LENGTH = 64;

/**
 * Characters that render as nothing, or reorder what follows them — exactly
 * what a forged name would use to read as somebody else's, or to break a label
 * out of its single line: C0/C1 controls, format characters (bidi overrides,
 * zero-width joiners), line/paragraph separators, lone surrogates and
 * private-use code points, plus the invisible-but-not-`Cf` ones that
 * `\p{Cc}\p{Cf}` alone misses (Hangul fillers, Khmer inherent vowels, Mongolian
 * vowel separator, braille blank, halfwidth Hangul filler).
 */
const INVISIBLE_RE =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}\u115F\u1160\u17B4\u17B5\u180E\u2800\u3164\uFFA0]/gu;

/**
 * Every other Unicode space folds to a plain one, so a name cannot pad itself
 * out of the label's measured width with ideographic or figure spaces.
 */
const UNICODE_SPACE_RE = /\p{Zs}/gu;

/**
 * A self-reported name as it is safe to display: invisible and
 * direction-changing characters removed, exotic spaces folded, length-capped,
 * trimmed. `null` for anything that is not a string — which for a run attribute
 * means "no recorded authorship" (text written before attribution shipped), and
 * the gutter leaves those lines blank rather than guessing a name.
 *
 * An empty result is a name that carried nothing displayable; callers render
 * that the same way they render an anonymous editor.
 */
export function sanitizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .replace(INVISIBLE_RE, '')
    .replace(UNICODE_SPACE_RE, ' ')
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
}
