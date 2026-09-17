import { isSafeUrl } from '@wafflebase/core/url';

/**
 * A run of characters inside a cell's rendered text that should paint and
 * behave as a hyperlink.
 *
 * `start`/`end` index the string they were detected in, so the painter can
 * measure the text before the span; `url` is where the span navigates, which
 * differs from the spanned text whenever the author omitted a scheme (a
 * `www.` prefix, a bare email address).
 */
export type LinkSpan = { start: number; end: number; url: string };

/**
 * A {@link LinkSpan} resolved to screen geometry by the painter.
 */
export type LinkBox = { x: number; width: number; url: string };

/**
 * The characters RFC 3986 allows in a URI.
 *
 * Restricting the span to this set — rather than to "not whitespace" — is what
 * makes an adjacent Korean particle (`https://example.com를`) or a CJK
 * sentence terminator end the link at the right character. The class also
 * excludes everything `hasUrlAlteringChars` refuses, so a detected span is
 * always the same string to `new URL()` as it is to whoever reads the cell.
 */
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DIGIT = '0123456789';

/** Character-membership lookup, built once. */
function charSet(chars: string): Set<string> {
  return new Set(chars.split(''));
}

const URL_CHAR = charSet(ALPHA + DIGIT + "-._~:/?#[]@!$&'()*+,;=%");
/** RFC 5321 local-part characters we are willing to recognize. */
const EMAIL_LOCAL_CHAR = charSet(ALPHA + DIGIT + '._%+-');
const EMAIL_DOMAIN_CHAR = charSet(ALPHA + DIGIT + '.-');

/**
 * Prefixes that begin a link, longest first so `https://` is not read as
 * `http` plus junk. `mailto:` is here rather than left to the address scanner
 * so that the scheme is part of the painted span instead of a bare
 * `foo@bar.com` with an unlinked `mailto:` in front of it.
 */
const SCHEMES = ['https://', 'http://', 'mailto:', 'www.'];

/**
 * RFC 5321's local-part ceiling, used as a scan bound rather than as
 * validation.
 *
 * Detection runs on every visible cell on every frame, so it has to be linear
 * in the cell's length. Expanding leftwards from each `@` without a bound is
 * what makes `('a'.repeat(k) + '@').repeat(m)` quadratic; capping it makes the
 * work per `@` constant.
 */
const MaxEmailLocal = 64;

/**
 * Longest run of URL characters worth reading as one link.
 *
 * Bounds the scanner's other unbounded walk. A scheme match consumes URL
 * characters forward, and when the result does not parse the scan resumes one
 * character later — so a run holding many non-parsing schemes
 * (`'https://['.repeat(n)`) is re-read from each of them, which is quadratic
 * again just by a different route. Google's own limit on a link destination is
 * 2000 bytes, so nothing real is lost.
 */
const MaxUrlLength = 2048;

/**
 * Extensions that are also country-code TLDs.
 *
 * `isHostname` cannot tell `example.sh` from `build@2.sh`, and §3's argument
 * for refusing schemeless hostnames applies verbatim to an address: in a cell,
 * `image@2x.png` reading as mail to `2x.png` is a correctness bug, not noise.
 * Retina asset names are the common case.
 */
const FILE_EXTENSIONS = charSetOf(
  `png jpg jpeg gif webp svg ico bmp tiff pdf doc docx xls xlsx ppt pptx
   zip tar gz rar sh bat ps1 exe dll so dylib txt md csv tsv json xml yml
   yaml toml ini log lock ts tsx js jsx py rb go rs java cpp css scss
   html mp3 mp4 mov avi wav ai psd`,
);

function charSetOf(words: string): Set<string> {
  return new Set(words.split(/\s+/).filter(Boolean));
}

/**
 * A match glued to the right of one of these is a coincidence, not a link —
 * `xhttps://evil.example.com` contains `https://evil.example.com` at index 1.
 *
 * Openers like `(` are deliberately absent: `(https://example.com)` is a URL
 * in parentheses, and refusing it would fail the commonest way people write
 * one down.
 */
const GLUED_LEFT = /[A-Za-z0-9+.\-_%]/;

/** Trailing characters that end a sentence more often than they end a URL. */
const TRAILING_PUNCTUATION = ".,;:!?'";

/** Closing brackets that only belong to the URL when it opened them itself. */
const BRACKET_PAIRS: Array<[string, string]> = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
];

/**
 * Trims the characters a writer put after a URL rather than in it.
 *
 * A closing bracket is kept only when the span opened one, so a Wikipedia path
 * (`/wiki/Foo_(bar)`) survives while a parenthesised link (`(https://x.com)`)
 * gives its paren back to the sentence.
 */
function trimTrailing(text: string): string {
  // Bracket balance is counted once, in a single forward pass, and then kept
  // in step as characters come off the end. Re-slicing and re-splitting the
  // remaining span per removed character — the obvious way to write this — is
  // O(L) work per character, i.e. O(L²) for the span, and this runs inside the
  // paint loop on author-controlled text bounded only by `MaxUrlLength`. A
  // cell of 2048 closing brackets would then cost millions of character
  // comparisons every frame.
  //
  // The counts stay correct because of what the loop below can remove: only
  // trailing punctuation (which holds no bracket) and a closing bracket (whose
  // own tally is decremented as it goes). An opening bracket is never removed
  // — it is neither, so the loop stops on it.
  const opened = new Map<string, number>();
  const closed = new Map<string, number>();
  for (const ch of text) {
    for (const [open, close] of BRACKET_PAIRS) {
      if (ch === open) opened.set(open, (opened.get(open) ?? 0) + 1);
      else if (ch === close) closed.set(close, (closed.get(close) ?? 0) + 1);
    }
  }

  let end = text.length;
  for (;;) {
    const last = text[end - 1];
    if (last === undefined) break;

    if (TRAILING_PUNCTUATION.includes(last)) {
      end--;
      continue;
    }

    const pair = BRACKET_PAIRS.find(([, close]) => close === last);
    if (pair) {
      const closes = closed.get(pair[1]) ?? 0;
      if (closes > (opened.get(pair[0]) ?? 0)) {
        closed.set(pair[1], closes - 1);
        end--;
        continue;
      }
    }

    break;
  }
  return text.slice(0, end);
}

/**
 * Turns a detected span into the URL it navigates to, or `null` when it is not
 * one we are willing to hand to `window.open`.
 */
function toUrl(text: string): string | null {
  let url = text;
  if (/^www\./i.test(text)) {
    url = `https://${text}`;
  } else if (!/^[A-Za-z]+:/.test(text)) {
    url = `mailto:${text}`;
  }
  return isSafeUrl(url) ? url : null;
}

/**
 * The scheme starting at `at`, or `null`.
 *
 * The first-character gate is what keeps this O(1) at the overwhelming
 * majority of positions: without it every position would allocate four
 * lowercased slices, and this runs at every character of every visible cell.
 */
function schemeAt(text: string, at: number): string | null {
  const first = text[at];
  if (first !== 'h' && first !== 'H' && first !== 'm' && first !== 'M') {
    if (first !== 'w' && first !== 'W') return null;
  }
  for (const scheme of SCHEMES) {
    if (text.slice(at, at + scheme.length).toLowerCase() === scheme) {
      return scheme;
    }
  }
  return null;
}

/**
 * Is `domain` shaped like a hostname with a real TLD?
 *
 * Checked with string operations rather than a pattern like
 * `(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`, whose nested quantifier is the same
 * backtracking hazard the scanner exists to avoid.
 */
function isHostname(domain: string, refuseFileExtensions = false): boolean {
  const dot = domain.lastIndexOf('.');
  if (dot <= 0 || dot === domain.length - 1) return false;
  const tld = domain.slice(dot + 1);
  if (tld.length < 2) return false;
  for (const ch of tld) {
    if (!/[A-Za-z]/.test(ch)) return false;
  }
  if (refuseFileExtensions && FILE_EXTENSIONS.has(tld.toLowerCase())) {
    return false;
  }
  return !domain.startsWith('.') && !domain.includes('..');
}

/** The host part of a `www.`-prefixed span, before any path or query. */
function hostOf(span: string): string {
  const cut = span.search(/[/?#]/);
  return cut === -1 ? span : span.slice(0, cut);
}

/**
 * Reads the bare email address surrounding the `@` at `at`, or `null`.
 *
 * Refuses an address immediately followed by `://`, which is not an address at
 * all but the tail of a glued-together string: in `a.b@c.dhttps://real.com`
 * the naive read is `a.b@c.dhttps`, which both invents a `mailto:` and eats
 * the scheme of the real link behind it.
 */
function emailAt(text: string, at: number): { start: number; end: number } | null {
  let start = at;
  while (
    start > 0 &&
    at - start < MaxEmailLocal &&
    EMAIL_LOCAL_CHAR.has(text[start - 1])
  ) {
    start--;
  }
  if (start === at) return null;
  // The walk stopped at the bound rather than at a boundary, so what it got is
  // a suffix of the local part, not the local part. Using it would underline
  // from the middle of a word and navigate to an address nobody typed; a local
  // part this long is invalid under RFC 5321 anyway.
  if (start > 0 && EMAIL_LOCAL_CHAR.has(text[start - 1])) return null;

  let end = at + 1;
  while (end < text.length && EMAIL_DOMAIN_CHAR.has(text[end])) end++;
  if (text.startsWith('://', end)) return null;

  const domain = trimTrailing(text.slice(at + 1, end));
  if (!isHostname(domain, true)) return null;
  return { start, end: at + 1 + domain.length };
}

/**
 * Finds every hyperlink inside a cell's **rendered** text.
 *
 * Callers must pass the string that is actually painted (i.e. `formatValue()`'s
 * output), not the raw cell value: the returned indices address characters, so
 * detecting against one string and measuring against another silently
 * misplaces the underline.
 *
 * Newlines need no special handling — they are outside {@link URL_CHARS}, so a
 * span never crosses one. That lets the painter call this per line and a test
 * call it on a whole multi-line value, with the same implementation.
 */
export function detectLinks(text: string): Array<LinkSpan> {
  if (!text) return [];
  // Cheap reject: almost no cell contains a link, and this spares them the
  // scan below entirely.
  if (
    !text.includes('://') &&
    !text.includes('@') &&
    !/www\./i.test(text)
  ) {
    return [];
  }

  const spans: Array<LinkSpan> = [];
  let i = 0;
  while (i < text.length) {
    const gluedLeft = i > 0 && GLUED_LEFT.test(text[i - 1]);

    const scheme = schemeAt(text, i);
    if (scheme && !gluedLeft) {
      const limit = Math.min(text.length, i + MaxUrlLength);
      let end = i + scheme.length;
      while (end < limit && URL_CHAR.has(text[end])) end++;
      // A run that hit the bound is not a link we are prepared to read: the
      // prefix we have may well parse, and linking a truncated destination is
      // worse than linking nothing.
      const overlong =
        end === limit && end < text.length && URL_CHAR.has(text[end]);
      const span = overlong ? '' : trimTrailing(text.slice(i, end));
      // A `www.` prefix is the one accepted form carrying no scheme, so its
      // host is checked for shape the way an address's is — `www.x` is not a
      // destination.
      const shaped =
        span.length > scheme.length &&
        (scheme !== 'www.' || isHostname(hostOf(span)));
      const url = shaped ? toUrl(span) : null;
      if (url) {
        spans.push({ start: i, end: i + span.length, url });
        i += span.length;
        continue;
      }
    }

    if (text[i] === '@') {
      // An address reaches backwards, so it must not reach into a span
      // already emitted.
      const floor = spans.length ? spans[spans.length - 1].end : 0;
      const found = emailAt(text, i);
      const url =
        found && found.start >= floor
          ? toUrl(text.slice(found.start, found.end))
          : null;
      if (found && url) {
        spans.push({ start: found.start, end: found.end, url });
        i = found.end;
        continue;
      }
    }

    i++;
  }
  return spans;
}

/**
 * Intersects a painted link box with the region the text was clipped to, or
 * returns `null` when none of it survived.
 *
 * The painter clips to the cell — widened when text overflows into empty
 * neighbours — so a span can be drawn and then be wholly or partly invisible.
 * A hit target taken from the unclipped box would leave a link clickable where
 * nothing is on screen, turning the pointer over blank cells.
 */
export function clipLinkBox(
  box: { left: number; top: number; width: number; height: number },
  clip: { left: number; top: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } | null {
  const left = Math.max(box.left, clip.left);
  const top = Math.max(box.top, clip.top);
  const right = Math.min(box.left + box.width, clip.left + clip.width);
  const bottom = Math.min(box.top + box.height, clip.top + clip.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Resolves spans to horizontal screen boxes within one rendered line.
 *
 * `lineStartX` is the line's already-aligned left edge (see `toLineStartX` in
 * `layout.ts`), and `measure` is the painter's own text measurer, so a box is
 * derived from the same arithmetic that positions the glyphs.
 */
export function layoutLinkBoxes(
  measure: (text: string) => number,
  line: string,
  spans: Array<LinkSpan>,
  lineStartX: number,
): Array<LinkBox> {
  return spans.map((span) => ({
    x: lineStartX + measure(line.slice(0, span.start)),
    width: measure(line.slice(span.start, span.end)),
    url: span.url,
  }));
}
