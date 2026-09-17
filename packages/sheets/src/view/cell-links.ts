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
/**
 * The characters a host is read out of. A mail domain and a URL authority are
 * the same shape, so one set reads both.
 */
const EMAIL_DOMAIN_CHAR = charSet(ALPHA + DIGIT + '.-');

/**
 * Characters allowed to *continue* a span past the ASCII set, once the URL has
 * reached its path.
 *
 * Letters, numbers and combining marks only — never whitespace, punctuation or
 * a control character, so the guarantee {@link URL_CHAR} documents still holds:
 * a detected span is the same string to `new URL()` as it is on screen.
 * Unpaired surrogates are accepted because the scan walks code units, and a
 * path character outside the BMP would otherwise cut the span in half.
 */
const PATH_LETTER = /[\p{L}\p{N}\p{M}]/u;
const SURROGATE = /[\uD800-\uDFFF]/;

function isPathChar(ch: string): boolean {
  return (
    ch.charCodeAt(0) > 0x7f && (PATH_LETTER.test(ch) || SURROGATE.test(ch))
  );
}

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
 * RFC 1035's ceiling on a fully qualified hostname, used the same way
 * {@link MaxEmailLocal} is: as a scan bound, not as validation.
 */
const MaxHostLength = 253;

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
  if (!isSafeUrl(url)) return null;

  // Refuse a userinfo component. `https://accounts.example.com@evil.example/`
  // paints as a link to a host the reader recognises and navigates to one they
  // do not, and the span is painted by a sheet any collaborator — or any
  // share-link viewer of an imported file — can write. The hover card shows
  // the real host, but the plain-click path deliberately skips the card, so
  // the only honest answer is not to make it a link at all.
  //
  // `mailto:` is unaffected: its `@` is in the path, not in an authority, so
  // the parser reports no username for it.
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  return url;
}

/**
 * Reads the host starting at `at`, or `null` when the run overruns the longest
 * legal hostname.
 */
function readHost(text: string, at: number): string | null {
  const limit = Math.min(text.length, at + MaxHostLength + 1);
  let end = at;
  while (end < limit && EMAIL_DOMAIN_CHAR.has(text[end])) end++;
  if (end - at > MaxHostLength) return null;
  return text.slice(at, end);
}

/**
 * The host at `at`, with the trailing punctuation {@link trimTrailing} would
 * take off the whole span removed — `see www.example.com. Next` ends a sentence
 * rather than naming a host called `example.com.`.
 */
function hostShapeAt(text: string, at: number): string | null {
  const host = readHost(text, at);
  return host === null ? null : host.replace(/[.-]+$/, '');
}

/** A dotted quad, which has no TLD for {@link isHostname} to check. */
function isIPv4(host: string): boolean {
  const parts = host.split('.');
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        part.length > 0 &&
        part.length <= 3 &&
        !/[^0-9]/.test(part) &&
        // A leading zero is not a longer spelling of the same number: the URL
        // parser reads `010` as octal, so `010.000.000.001` paints as itself
        // and opens `8.0.0.1`. The URL Standard's canonical form has none, and
        // painting one host while opening another is the defect the userinfo
        // rule above exists to prevent.
        (part === '0' || part[0] !== '0') &&
        Number(part) <= 255,
    )
  );
}

/**
 * Does a link starting at `start` have an authority worth reading the rest of?
 *
 * This is the scanner's prefilter, and the order matters: it answers from
 * indices alone, bounded by {@link MaxHostLength} / {@link MaxEmailLocal},
 * *before* the candidate is sliced, trimmed and handed to `new URL()`. Doing it
 * the other way round — the obvious order, and the one this file shipped with —
 * left {@link MaxUrlLength}'s worth of work at every position inside a run that
 * is not a link: `'/www.'.repeat(n)` restarted a 2048-character walk plus a
 * 2048-character slice, trim and parse every five characters, roughly 400x
 * amplification on author-controlled text inside the paint loop. Every shape
 * that reaches the expensive path now goes on to *emit* a span, so the scan
 * skips past it instead of re-reading it.
 *
 * A host terminated by `@` is refused here as well as in {@link toUrl}: it is
 * userinfo, not a host.
 */
function hasAuthorityAt(text: string, start: number, scheme: string): boolean {
  if (scheme === 'mailto:') {
    const at = start + scheme.length;
    let end = at;
    const limit = Math.min(text.length, at + MaxEmailLocal);
    while (end < limit && EMAIL_LOCAL_CHAR.has(text[end])) end++;
    if (end === at || text[end] !== '@') return false;
    const domain = hostShapeAt(text, end + 1);
    return domain !== null && isHostname(domain);
  }

  // `www.` carries no scheme, so its own prefix is part of the host.
  const at = scheme === 'www.' ? start : start + scheme.length;
  const raw = readHost(text, at);
  const host = hostShapeAt(text, at);
  if (raw === null || host === null) return false;
  if (text[at + raw.length] === '@') return false;
  // A dotted quad and `localhost` are hosts a sheet really does carry — an
  // internal service, a dev server — and neither has a TLD. An IPv6 literal
  // (`https://[::1]/`) is not accepted: `[` is not a host character, and
  // nobody writes one in a cell.
  return isHostname(host) || isIPv4(host) || host.toLowerCase() === 'localhost';
}

/**
 * Extends a span past the ASCII run when the URL had already reached its path
 * and the next character is a letter outside ASCII.
 *
 * Without this, a pasted `https://wiki.example.com/x/기획문서` stops at the
 * first Hangul syllable and links `https://wiki.example.com/x/` — a *different*
 * destination that parses and passes `isSafeUrl`, which is exactly the
 * truncated link the scheme branch refuses elsewhere on principle.
 *
 * Gated on the path having started, so the authority stays ASCII-only: that is
 * what keeps an IDN homograph host (`https://аpple.com`, Cyrillic а) out of a
 * span, and it is the reason this is not simply a wider character class.
 */
function extendPath(
  text: string,
  authorityStart: number,
  from: number,
  limit: number,
): number {
  if (from >= text.length || !isPathChar(text[from])) return from;
  if (text.slice(authorityStart, from).search(/[/?#]/) === -1) return from;
  let end = from;
  while (end < limit && (URL_CHAR.has(text[end]) || isPathChar(text[end]))) {
    end++;
  }
  return end;
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
  // An address written straight after a slash is part of a URL that was
  // refused, not prose — `https://accounts.example.com@evil.example/reset` is
  // turned down for its userinfo, and reading the tail of it as mail to
  // `evil.example` would hand back a link over the very characters that were
  // just judged deceptive.
  if (start > 0 && text[start - 1] === '/') return null;

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

  // The contiguous run of URL characters covering the position last asked
  // about. A run is contiguous, so every position inside one shares its end
  // and the forward walk is paid once per run rather than once per scheme
  // start inside it — the other half of the amplification `hasAuthorityAt`
  // describes.
  let runFrom = -1;
  let runTo = -1;
  const urlRunEnd = (from: number): number => {
    if (from >= runFrom && from < runTo) return runTo;
    let end = from;
    while (end < text.length && URL_CHAR.has(text[end])) end++;
    runFrom = from;
    runTo = end;
    return end;
  };

  let i = 0;
  while (i < text.length) {
    const gluedLeft = i > 0 && GLUED_LEFT.test(text[i - 1]);

    const scheme = schemeAt(text, i);
    if (scheme && !gluedLeft && hasAuthorityAt(text, i, scheme)) {
      // One past the bound, so a run that reaches it is recognisable as having
      // overrun rather than as having ended there.
      const limit = Math.min(text.length, i + MaxUrlLength + 1);
      const end = extendPath(
        text,
        i + scheme.length,
        Math.min(urlRunEnd(i), limit),
        limit,
      );
      // A run that hit the bound is not a link we are prepared to read: the
      // prefix we have may well parse, and linking a truncated destination is
      // worse than linking nothing.
      const overlong = end - i > MaxUrlLength;
      const span = overlong ? '' : trimTrailing(text.slice(i, end));
      const url = span.length > scheme.length ? toUrl(span) : null;
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
