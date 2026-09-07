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
