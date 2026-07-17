# Share Link Permissions — lessons

## A "list" endpoint is part of the permission surface, not just a read

The first cut gated *creation* correctly (members can't mint editor links) but
`findByDocument` still returned every link — including editor tokens — to plain
members. Since a share token is copy-and-paste redistributable, exposing an
editor token to someone who can't create one re-opens the exact escalation the
create-gate closed. Lesson: when a resource is a bearer credential, listing it
grants the same power as creating it. Gate reads by the same matrix as writes.

## Preserve the invariant you're replacing, don't just add checks

Adding `resolveCapability` at the top of `delete` silently dropped the original
invariant "a link's creator can always revoke it" — a creator who left the
workspace lost the ability to clean up their own live anonymous link. When
tightening an authorization path, enumerate the *existing* allow-paths and keep
each one, rather than layering a new gate in front of all of them.

## Push per-item authorization to the server; don't re-derive identity on the client

The revoke button first depended on `fetchMe` + `link.createdBy === me.id`. That
made a security-relevant control depend on an async query that can be pending or
(with `retry:false`) permanently failed, hiding the button from users who
legitimately own the link. Returning a server-computed `canDelete` per link
removed the whole class of bug and kept the client dumb. If the server already
knows the answer, send the answer, not the inputs.

## Client gating driven by async state needs a `loaded` gate + reset-on-key-change

Defaulting permissions to "all false" and flipping them after fetch produced two
opposite glitches: managers briefly saw the editor option disabled, and stale
perms from a previously-opened document leaked across a `documentId` change.
Fix pattern: a `loaded` flag that suppresses gating hints and disables the
action button until the fetch resolves, plus resetting state at the start of
each fetch with a cancellation guard.

## Adversarial self-review earns its keep on permission changes

A high-effort workflow review found the token-exposure escalation and the
delete regression that the passing unit + integration tests did not — the tests
asserted the new behavior worked, not that the *old* guarantees survived. For
authorization work, run the adversarial pass before pushing.
