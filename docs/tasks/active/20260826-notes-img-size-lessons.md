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

## Tailwind preflight quietly owns `img { height: auto }`

Presentational hints from `<img width>` / `<img height>` lose to any author
CSS declaration, and preflight ships `img, video { max-width: 100%; height:
auto }`. `width` survives (preflight sets no `width`), so the issue's headline
case works; a lone `height` does not bite. Worth knowing before promising that
an HTML sizing attribute "just works" on a Tailwind surface — GitHub's own
markdown CSS deliberately sets no `height`.
