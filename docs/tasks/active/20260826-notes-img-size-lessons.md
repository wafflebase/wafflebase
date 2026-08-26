# Lessons — Notes image width/height (issue #973)

## markdown-it's default `image` render rule needs both `alt` and `children`

`default_rules.image` does
`token.attrs[token.attrIndex('alt')][1] = renderInlineAsText(token.children)`.
So a hand-pushed `image` token must (a) always carry an `alt` attribute — a
missing one indexes `attrs[-1]` and throws — and (b) carry the alt text as a
child `text` token, not just as `token.content`, or the rendered `alt` comes
out empty. Reusing the `image` token type (rather than a bespoke one) is what
lets `preview.ts`'s existing `loading="lazy"` / `decoding="async"` hook and
markdown-it's own attribute escaping apply unchanged.

## Declining beats sanitizing

The rule refuses the whole tag when it sees anything outside
`src`/`alt`/`width`/`height`. Dropping the unknown attribute instead would be
equally safe (we only ever emit our own four), but it would silently change
what the author wrote — a `style="width:200px"` would render at intrinsic size
with no hint why. Falling through to escaped literal text tells them the shape
is unsupported, and it is the behavior that already exists today.

## A tag regex ending `[^<>]*?` + `\s*` is a stored main-thread hang

The first cut spelled the tag `/^<img(\s[^<>]*?)?\s*\/?>/i` — a lazy class that
matches whitespace, immediately followed by a greedy `\s*` that also does. On
`<img` + a long whitespace run with no closing `>`, the engine tries every split
of that run between the two quantifiers and re-walks `\s*` for each: measured
4.5 ms at 2 000 spaces, 17.5 ms at 4 000, 70 ms at 8 000 — clean quadratic, so
~11 s at 100 000. That is not a local hiccup. The preview's `render()` is
synchronous, and the note text is CRDT-shared, so one collaborator saving that
line freezes everyone else's tab.

The fix is shape, not a length cap: one greedy `[^<>]*` with nothing quantified
after it, so each input has exactly one candidate split. The self-closing `/`
then has to be stripped from the captured region afterwards rather than matched
by a tail of its own — a deliberate trade of a little tidiness for a regex with
no ambiguity in it. General rule for these allowlist plugins: two adjacent
quantifiers whose character classes intersect is the whole bug, and the input
that finds it is always the *unterminated* one, which no happy-path test covers.

## Tailwind preflight quietly owns `img { height: auto }`

Presentational hints from `<img width>` / `<img height>` lose to any author
CSS declaration, and preflight ships `img, video { max-width: 100%; height:
auto }`. `width` survives (preflight sets no `width`), so the issue's headline
case works; a lone `height` does not bite. Worth knowing before promising that
an HTML sizing attribute "just works" on a Tailwind surface — GitHub's own
markdown CSS deliberately sets no `height`.
