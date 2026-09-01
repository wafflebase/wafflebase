# Lessons — template Phase 2 leftovers + thumbnail capture

Paired with
[`20260901-template-thumbnails-todo.md`](20260901-template-thumbnails-todo.md).

## Check the constraint before designing around the wrong one

The thumbnail design was sketched as "an offscreen renderer per document
type". Two hours of that plan were spent before the real constraint surfaced,
and it was not the renderers: **canvas tainting**. The editors load images
without `crossOrigin` on purpose, so any document containing a remote image
poisons `toBlob` no matter which canvas the pixels came from — offscreen or
on-screen, the taint follows the source `<img>`.

Had that been checked first (one grep for `crossOrigin`), the shape of the
work would have been obvious immediately: the per-type renderer question is a
*quality* question, while tainting is a *coverage* question, and coverage is
the one that decides whether the feature is worth building at all.

**Rule:** for any feature that reads pixels out of a canvas, check the taint
story before choosing a renderer.

## Two upload routes, and copying the wrong one stores an unservable id

Found by the user's smoke test, not by any test written here:

```text
GET /images/81c32d49-….webp → 500  NoSuchKey  Key: 81c32d49-….webp
```

`postImage` was written by copying `uploadImageFile`, which posts to
`POST /api/v1/workspaces/:wid/images`. That route stores the object under
`{workspaceId}/{id}` and returns a **bare** id; it is read back only through
the access-gated `GET /api/v1/workspaces/:wid/images/:id`. The template card
reads the *unauthenticated* `GET /images/:id`, which looks at the bucket root.
So the upload succeeded, the listing stored an id, and no route the card can
call could resolve it.

The design doc even said which route to use ("uploaded through the existing
`POST /images`"). What went wrong was reading the *code* for how to upload and
the *design* for which id to store — two sources, one silent mismatch. The
helper is now split as `postWorkspaceImage` / `postSharedImage`, and the file
opens by stating that ids are not portable between them.

**Rule:** when a value crosses from a writer to a *different* reader, verify
the reader can resolve it. "The upload returned 200" proves nothing about that.

Two things followed from the same log. The read route answered **500** on a
missing key, because an S3 `NoSuchKey` escaped unhandled — an id outlives the
object it names, so "gone" is an ordinary outcome of a public route and now
answers 404 (the v1 read controller already did this). And the card now hides a
thumbnail whose `<img>` fails, falling back to the type icon instead of a
broken-image glyph.

## An architecture lint is a design input, not an obstacle

`components/**` may not import `@/app/*` (`eslint.arch.config.js`). The Share
dialog lives in `components/`, every renderer lives in `app/`. The rule made
the direct call impossible — and the registry it forced (editors *register*,
the dialog *asks*) is better than the direct call would have been: the dialog
knows nothing about decks, and the editors know nothing about templates.

The same rule also decided where the upload helpers belong. `uploadImageFile`
had the endpoint buried in `app/spreadsheet/`, unreachable from `components/`;
extracting the bare POSTs into `api/images.ts` removed a duplicate rather than
creating one — and put the two routes side by side, which is where the
distinction above became statable at all.

## `FormData.append` with a filename rewraps the value

`formData.append("file", file, filename)` produces a **new** `File`, so an
existing test asserting `body.get("file")` was the same object failed the
moment a default filename was added to the shared helper. The filename is now
passed only when the caller has one to give (a raw `Blob` needs it for the
server to see an extension; a named `File` does not).

Cheap lesson, but the failure mode is worth remembering: identity assertions
on `FormData` values are load-bearing, and the third argument is not inert.

## Verify a "missing" item before implementing it

One of the four Phase 2 leftovers — "a manager may unpublish any listing in
their workspace" — was already true: `assertManager` runs `isDocumentManager`,
which grants a workspace owner authority over any document in the workspace.
The right output was two tests, not a feature.

Reading the code that would implement an unchecked box, before writing the
box's code, cost five minutes and saved a redundant change.
