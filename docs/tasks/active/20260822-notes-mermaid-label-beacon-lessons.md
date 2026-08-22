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
