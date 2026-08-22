# Lessons — notes mermaid label beacon (issue #721)

## A sanitizer downstream of a layout pass is not a fetch boundary

The three-layer defense around the mermaid preview was written on the
assumption that layer 3 (`sanitizeSvg()`) governs what reaches the reader's
document. It governs what *persists*. Mermaid measures text by laying the
diagram out in the live `document.body` first, so any HTML label subtree it
builds has already been parsed — and any `src`/`url()` in it already
fetched — before the caller sees a string. The evidence in the issue is exactly
this shape: zero `<img>` in the final DOM, three requests in the server log.

The fix therefore had to move *upstream*, into what the engine is allowed to
build: `htmlLabels: false` means there is no HTML label subtree to lay out at
all, so there is nothing to fetch during measurement.

## A strip pass can manufacture the carrier it is removing

`stripConfigDirectives()` removed exactly one front-matter block because
`FRONTMATTER_RE` is `^`-anchored. Removing it promotes the *next* `---` block
to leading position, where mermaid parses it — the source did not have a
leading carrier there, the strip created one. The same holds across carrier
kinds: stripping a leading `%%{init}%%` directive can promote a following
`---` block.

Anything that removes a prefix-anchored construct from untrusted input should
run to a **fixpoint**, not once. The loop terminates for free because each
iteration that changes anything strictly shortens the string.

## Tightening a sanitizer profile is not free just because it is narrower

The issue suggested collapsing DOMPurify to the SVG profile alone once no HTML
is in the diagram. Grepping the installed engine showed several diagram types
(`venn-text-node-fo`, architecture icons, kanban, sequence) appending a
`foreignObject` with no `htmlLabels` guard at all, so that collapse would have
silently emptied those labels while the security posture stayed the same —
`img`/`image` are already forbidden. Verify what the engine *actually* emits
before narrowing an allowlist to what it is supposed to emit.

## Closing one carrier of a class is not closing the class

Review pushed back that `htmlLabels: false` closes only the *label* path, and
reading the pinned engine confirmed it: `imageSquare()` fetches
`A@{ img: "…" }` twice (`new Image().decode()` plus an SVG `<image href>` in
the layout host) with no label involved, and the diagram types that emit a
`foreignObject` regardless hand their label to mermaid's own `sanitizeText()`,
whose default DOMPurify allowlist permits `<img src>`. The durable answer was
to stop describing the fix as "no label subtree" and instead refuse a fence
whose *source* carries a fetch at all — a rule that is indifferent to which
label path a future release uses. That refusal costs nothing visible: layer 3
already forbade every one of those constructs in what persists, so the only
thing removed is the request.

## "Run to a fixpoint" needs a bound when the input is attacker-controlled

The fixpoint loop above was the right shape and the wrong contract. Each pass
rescans the whole body but removes at most one leading front-matter block, so a
fence of stacked minimal blocks is quadratic — a stored freeze of every
reader's main thread. Mermaid's `maxTextSize` is no help: the engine enforces it
inside `render()`, after the strip has already run. Cap the length *and* the
passes, and refuse a source still changing at the bound.

## A config round-trip is not an engine assertion

The first attempt at "the real engine honors `htmlLabels`" re-initialized
mermaid with a hardcoded literal and read the key back — it would have passed
with the production call deleted. Real mermaid does run its layout pass under
jsdom once `SVGElement.prototype.getBBox` is stubbed, so the honest test drives
the production config through the real engine and asserts the *outcome* (no
`foreignObject` in the serialized output), with a control case proving the same
source emits one at the engine's default. Both singletons it borrows — the
prototype and mermaid's global config (`mermaidAPI.globalReset()`) — have to be
put back, or every later case inherits them.
