# File viewer: leaving an image returns to the workspace root, not its folder

Open an image that lives in a folder, click the header back arrow (or press
Esc): the documents list comes back at the **workspace root** instead of the
folder the image was opened from. The folder the user was browsing is lost.

## Root cause

A folder is a query parameter on the workspace list route, not a path
segment — `workspace-documents.tsx:16`:

```ts
const folderId = searchParams.get("folder");   // /w/:slug?folder=<id>
```

`useDocumentsPath` never produces that parameter
(`use-documents-path.ts:19-21`):

```ts
const slug = workspaces.find((w) => w.id === workspaceId)?.slug ?? workspaces[0]?.slug;
return slug ? `/w/${slug}` : "/documents";
```

so every destination it computes is a workspace root. The back button
(`file-detail.tsx:131`) and the viewer's Esc key share that path, as does
`FileShell`'s not-found redirect (`file-shell.tsx:62`).

The data is not missing: `GET /documents/:id` returns the whole Prisma row,
`folderId` included (`document.controller.ts:164-178`), and the frontend
`Document` type already declares it (`types/documents.ts:43`). `FileDetail`
just never passes it down — it hands `ImageFileLayout` a `workspaceId` and
nothing else (`file-detail.tsx:237-245`).

### Second defect, same cause

The viewer's prev/next neighbours are collected workspace-wide with no folder
filter (`image-viewer.tsx:117-129`):

```ts
.filter((d) => d.type === "image" && d.workspaceId === current.workspaceId)
```

so `←`/`→` inside a folder walk into images from other folders, and the back
button then returns to a folder the user never opened. Same fix scope: carry
the folder through the viewer.

## Tasks

- [x] Failing tests first: `useDocumentsPath` carries `?folder=`; the image
      viewer's neighbours stay inside the folder
- [x] `use-documents-path.ts`: accept `folderId`, append `?folder=<id>` —
      only when the document's *own* workspace resolved (a folder id means
      nothing in the fallback workspace's tree)
- [x] `file-detail.tsx`: pass `folderId` into `ImageFileLayout`
- [x] `file-shell.tsx`: feed the not-found redirect the same folder
- [x] `image-viewer.tsx`: scope the prev/next sibling list to the folder
- [x] `docs/design/image-viewer.md`: the doc described the shipped bug
      ("prev/next across the workspace's images", a destination with no
      folder in it), so it is corrected alongside the code
- [x] `pnpm verify:fast`
- [x] Self review over the branch diff
- [ ] Browser smoke: open an image inside a folder, back arrow returns to it

## Review

Six tests were written first and all six failed against `main` for the
reason above (`expected '/w/second' to be '/w/second?folder=f1'`, and the
arrows reaching `/f/d2` — a root image — from inside a folder). All 24 tests
in `src/app/files/__tests__` pass after the change; `pnpm verify:fast` is
green.

Two points the implementation had to decide:

- **The folder is dropped on the workspace fallback.** `useDocumentsPath`
  falls back to `workspaces[0]` when the document's own workspace is not in
  the list. Folder ids are scoped to one workspace's tree, so carrying one
  into that fallback would open a list filtering on a folder that does not
  exist there — an empty page. The hook now keeps the resolved workspace
  (`own`) separate from the slug it ends up using, and appends `?folder=`
  only when the two are the same. Covered by a test.
- **`(d.folderId ?? null) === (current.folderId ?? null)`** rather than a
  plain `===`: the list rows and the single-document response both carry the
  column, but the frontend type declares it `string | null | undefined`, so
  a root image can compare `undefined` against `null`. Both spellings mean
  the workspace root.

Scope deliberately left alone: the other document types (`/s/`, `/d/`,
`/p/`, `/n/`, `/b/`) have no back button at all, so there is nothing there
that returns to the wrong list — adding one is a separate feature, not this
fix. The back button also still *pushes* its destination rather than popping
history; that is unchanged and correct, since the viewer is reachable by
direct link with no history to pop.
