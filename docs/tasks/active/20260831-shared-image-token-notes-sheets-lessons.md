# Lessons — shared-link image token for notes and sheets

## A "deferred follow-up" in a commit message is an open bug

PR #955 fixed this class of defect for slides, wrote down in its own commit
message that sheets and notes were still broken, and shipped. Nothing tracked
that sentence: no issue, no todo file, no test. It surfaced months later as a
user reporting that a shared note showed no images at all.

**Rule:** when a fix knowingly leaves a sibling surface broken, the deferred
half needs an artifact that outlives the commit message — an issue, or an
unchecked box in a task file that `tasks:archive` will keep alive. A commit
message is not a tracker; nobody greps it.

## A justification comment can encode the bug

`useSharedImageTokenResolver`'s doc comment read:

> pdf/image/file/note don't paint through this engine

Every word of that is true, and it is the wrong test. The question the code
needed to answer was "does this type render a workspace image?", not "does
this type use the slides canvas?". The comment quietly narrowed the invariant
to the one engine the author had in hand, and then read as deliberate.

**Rule:** when a comment justifies an exclusion, check that its predicate is
the one the code actually cares about. "Doesn't use X" is not "doesn't need
the fix" unless X is the only way to need it.

## Verify the whole path, not the layer you changed

The backend already accepted `?token=` and had 285 lines of controller tests
proving it. Those tests passed the entire time the feature was broken in
production, because nothing exercised "does the frontend actually send it".

The check that would have caught it is one line in a browser:

```js
[...document.querySelectorAll('img')].map(i => [i.src, i.naturalWidth])
```

`naturalWidth === 0` is the cheapest possible assertion that an image is
broken, and it works on the deployed site with no fixture or login.

## Two consumers of one URL must derive it the same way

`image-object-layer` called `getOrLoadImage(image.src)` to warm the cache and
then rendered `<img src={image.src}>`. Resolving in only one of those places
would have made the browser issue a second, un-tokened request that still
403s — a fix that looks right in the cache test and fails on screen. Hence
`resolveImageSrc` is exported alongside `getOrLoadImage` rather than being
kept private to the cache: the seam belongs to everyone who names the URL.

## Small things worth keeping

- A type-keyed dispatch table whose key comes from an API response wants a
  `Map`, not an object literal. `INSTALLERS["constructor"]` on an object
  literal returns a function, and the surrounding truthiness check passes.
- Verifying against production from a local build needs CORS relaxed
  (`--disable-web-security` + a throwaway `--user-data-dir`), and that is
  safe here precisely because the thing under test — an `<img>` load — is not
  a CORS-governed request. Relaxing CORS changed the fetch that resolves the
  share link, not the behavior being verified.
- `markdown-it` re-parses tokens on every `render()`, so mutating
  `token.attrGet('src')` in a render rule cannot compound across renders.
  Worth asserting anyway (the "token change takes effect" test), because that
  property is what makes the seam safe and it is not locally obvious.
