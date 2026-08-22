# Lessons — bridge client (PR 9a, #846)

## A boundary is only a boundary if a test walks it

`./client` exists so a browser bundle cannot reach `node:fs`. Nothing enforces that but
`test/client/boundary.test.ts`, which follows the import graph from the subpath and fails on
the first `node:` specifier. Without it the rule is a comment.

## `registry.tsx` was population A on paper and population C in fact

It maps component names to live renderers, and every entry imports one of *wafflebase's*
components. Reading the file settled in a minute what the classification table had had wrong
since it was written — and the same correction later removed `PreviewPane` from the rollout
entirely.
