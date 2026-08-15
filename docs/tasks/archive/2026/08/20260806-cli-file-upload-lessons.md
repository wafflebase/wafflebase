# CLI file upload — lessons

## Unit tests that stub a header cannot catch a missing header

Every CLI-side download test fed `parseContentDispositionFilename` a header the
test itself wrote, so they all passed while the server was sending
`Content-Disposition: inline` with **no filename at all** for `pdf` and `image`
documents. The bug only appeared in the end-to-end run, where a downloaded PNG
landed at `./<uuid>` instead of `./tiny.png`.

**Rule:** when a client behavior is driven by a server-produced value, at least
one test must obtain that value from the server. Stubbing both sides of a
contract tests the stub.

## Derive a value from the table that validates it

`blobDocumentTypeFor` picks the document type by running the *same*
`FILE_ID_EXT` patterns that `assertFileIdAllowed` later checks, on the *stored*
`fileId` rather than the client's filename. The two steps therefore cannot
disagree, and the extension has already been through `safeExtension` by then.
The alternative — a second extension→type map next to the existing one — is
where drift lives.

## Extending a surface makes its latent bugs routine

`DELETE /api/v1/.../documents/:did` never deleted the stored blob. That was
already wrong, but hard to hit: v1 could not *create* blob documents. Adding
`POST /files` turned a rare leak into the normal path, which is what made it
in scope. When adding a capability to a surface, check what its existing
neighbors do with the new kind of object.

## A local stack with an empty database is not a working test environment

`pnpm dev` was up, but no user had ever signed in, so there was no workspace to
upload into. Seeding one directly (a row each in `User`/`Workspace`/
`WorkspaceMember`, plus an access token minted with the backend's `JWT_SECRET`)
took minutes and made a real 21-assertion end-to-end run possible — including
the header bug above. Clean up the seeded rows afterwards.

Two traps while doing it:

- `WorkspaceScopeGuard.resolveId` treats a non-UUID as a **slug**. A seeded
  workspace with a readable id like `ws-smoke-0001` 404s on every v1 route.
  Seed a real UUID.
- CLI flags beat env vars beat the session file — but a stale `session.json`
  pointing at production still won the workspace slot over
  `WAFFLEBASE_WORKSPACE`. Pass `--server` / `--api-key` / `--workspace`
  explicitly when scripting against a local server.

## `verify:fast` does not lint the backend

The gate runs `frontend lint`, but for the backend only `backend lint:arch`
(the architecture ruleset) — never `backend lint:check`. So prettier violations
and `@typescript-eslint/no-unsafe-*` errors in new backend code pass every local
and CI lane and only surface in review.

**Rule:** after touching `packages/backend`, run
`pnpm --filter @wafflebase/backend exec eslint <changed files>` before pushing.
(`packages/cli`'s own `lint:check` is currently broken — no eslint config
matches its files — so there is nothing to run there.)

## "Consistent with the neighbors" is not a reason to skip an auth check

I left `POST /files` without an API-key `write`-scope check because no v1 write
endpoint except `documents.delete` has one, and adding it to only the new route
felt inconsistent. That was the wrong call, and review caught it: the
consistency being preserved was consistency with a hole, `scopes` exists for
exactly this, and a brand-new endpoint has no clients depending on the laxer
behavior. Match the *correct* neighbor, not the majority one — and say plainly
in the PR that the others remain unfixed.

## Skill safety metadata is an interface, not a label

`files-upload-download.md` advertised `safety: write / read-only` while
documenting `files delete`, which the schema registry marks `destructive`.
Agents choose whether to ask for confirmation from that frontmatter, so
under-stating it removes a confirmation prompt from a data-destroying command.
When a skill's command list grows, re-derive the safety line from the registry
rather than editing it by feel.

## Multipart in a JSON-shaped HTTP client

Two things bite when adding a multipart request to a client whose every other
call is JSON:

- The shared `Content-Type: application/json` header must not be sent — `fetch`
  has to generate the boundary. Splitting the header getter into `authHeaders`
  (auth only) and `headers` (auth + JSON) made both paths honest.
- A `FormData` body is consumed by the first send, so the retry-after-refresh
  path must **rebuild** it. Passing a `build(auth)` callback to the retry
  helper, rather than a prepared `RequestInit`, gets that for free.

Also: `new Blob([buffer])` fails to typecheck under Node types, because a
`Buffer` is `Uint8Array<ArrayBufferLike>` while a Blob part must be
`Uint8Array<ArrayBuffer>`. Re-view the same memory
(`new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)`)
instead of copying — the payload can be 50 MB.
