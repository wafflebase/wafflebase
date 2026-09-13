# Lessons — share-link image upload (issue #1037)

## A 401 is a UX decision, not just a status code

`fetchWithAuth` treats every 401 as "your session expired" and responds by
logging out and navigating to `/login`. That is right for a workspace route
and wrong for anything an anonymous share-link visitor can reach: the visitor
has no session to expire, so the recovery destroys the only access they had.
The rule that falls out: **an anonymous surface must not call `fetchWithAuth`
at all.** `SharedLakehouseUnavailable` already existed for exactly this reason
("avoids fetchWithAuth redirecting anonymous share-link viewers to /login") —
the pattern was known, the docs image path just predated it.

## Read-side precedents were the wrong thing to copy

Both existing anonymous share-token routes (`ApiV1ImageReadController`,
`DocumentFileController`) deliberately ignore `link.role`, because a viewer
link is *supposed* to read. Copying either verbatim for a write would have let
a viewer upload. The role check belongs with the verb, and the authority for
"an anonymous editor may write" already lives in exactly one place —
`yorkie-auth.controller.ts` — which is what this mirrors.

## Two spines in one document is fine; one seam is not optional

Docs uploads through the root-bucket `/images` route while the fix uploads
through the workspace spine, so a single document can hold both kinds of URL.
That works only because `appendShareTokenToImageUrl` matches on the workspace
path and leaves everything else alone. What is *not* optional is the engine
seam: without `setImageUrlResolver` in the docs image cache, an anonymously
inserted image 403s for its own author, and the failure is silent (a blank
rectangle on the canvas, no console error the user will read).

## The insert path read the image twice, and only one read had a token

The defect self-review caught. `insertImageFromFile` uploaded, then probed the
*uploaded URL* through a bare `<img>` to learn its pixel size. On the owner
spine that URL is unauthenticated, so it worked and nobody noticed the second
read existed. On the workspace spine it needs the visitor's `?token=` — which
the stored URL deliberately does not carry — so the probe 403'd and the insert
failed **after** a successful upload, with the bytes already in the bucket and
a toast blaming the upload.

The lesson is not "remember to token the probe". It is that a URL which is
only readable through a per-viewer resolver has exactly one legitimate reader:
the renderer that applies the resolver. Any *other* code that loads the same
URL is a second, untokened path waiting to fail. Here the second read was also
unnecessary — the file is in hand, so measure it locally
(`URL.createObjectURL`), which is what the other three engines already do.

The regression guard is a test that asserts which `src` values are assigned
during an insert (`blob:local` and nothing else), rather than one that checks
the insert succeeded — the bug was an extra request, so the request list is
the thing to assert on.

## Where the workspace id comes from decides the whole design

The obvious shape — reuse `POST /api/v1/workspaces/:workspaceId/images` with
an added token branch — cannot work, and not only because
`WorkspaceScopeGuard` needs a `user.id` that does not exist. Accepting a
client-supplied `:workspaceId` from an anonymous caller means the token proves
access to workspace A while the bytes land under workspace B's key prefix.
Deriving the id from `link.document.workspaceId` is what makes the route
sound, and it is why the route has no workspace path segment at all.

## Multer runs before the handler

Nest's interceptor pipeline buffers the multipart body before `assertCanWrite`
ever executes, so an unauthenticated request does allocate before it is
refused. `IMAGE_UPLOAD_MULTER_LIMIT_BYTES` bounds that per request and the
throttle bounds the rate; a guard would have refused earlier (guards run
before interceptors), at the cost of a second place where share-token write
authority is decided. Recorded here as the tradeoff actually taken, not as an
oversight.
