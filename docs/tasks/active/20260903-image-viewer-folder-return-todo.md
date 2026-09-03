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
- [x] Self review over the branch diff (subagent reviewer), findings applied
- [x] Browser smoke: open an image inside a folder, back arrow returns to it

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

### Verified in a real browser

Against the running dev stack, with the image the reporter linked: the live
`GET /documents/:id` response does carry `folderId`, and the full loop
(folder list → open the image → back arrow) lands on
`/w/hackerwins-s-workspace?folder=a5efeafc-…` with the folder's breadcrumb
(`Home / test`) and contents rendered. Esc reaches the same destination.

**Not** browser-verified: the prev/next folder scoping. That workspace holds
a single image, so the arrows never render — it rests on the two unit tests
alone.

### Review findings applied

A reviewer subagent read the branch diff and the surrounding files. No
Critical findings; both Important ones were about the change being
*unfalsifiable* rather than wrong, and both are fixed:

1. **`file-shell.tsx`'s share of the fix was unpinned.** Its test file still
   used the pathname-only location probe — the exact accomplice the lessons
   file names — and no case supplied a folder, so deleting the new argument
   would have kept the suite green. Now probed on `pathname + search`, with
   a case that reaches the shell's own error branch the only way production
   can (a refetch failure *after* a success, where react-query keeps the
   last data so the folder is still known). Confirmed a real discriminator
   by reverting the argument: `expected '/w/second' to be
   '/w/second?folder=f1'`.
2. **The relocated mock defaults leaned on an undocumented invariant.**
   Hoisting them to a file-level `beforeEach` worked only because
   `clearAllMocks` keeps implementations where `resetAllMocks` drops them —
   one apparently-equivalent edit away from an empty sibling list, which is
   precisely what makes the arrow assertions pass vacuously. Each `describe`
   now sets the data it needs in its own hook.

Minor findings applied: the design doc's prev/next bullet was still wrong
about the *component* and the fetch scope (`ImageViewer`, not `FileDetail`,
and it fetches every workspace's documents then filters client-side); the
`image-viewer.tsx` comment claimed the arrows follow "the list the user was
browsing", which is only true when they arrived from that folder; and
`useDocumentsPath` now separates *which slug* from *whether to keep the
folder* with an early return instead of fusing both into one ternary.

### Follow-ups not taken here

- **A folder deleted while the viewer is open.** `Document.folderId` is
  `SetNull`, but `["document", id]` has a 5-minute `staleTime`, so back can
  navigate to `?folder=<deleted id>`. `folderPath()` returns `[]` for an
  unknown id, so the list renders as a bare "Home" with no rows —
  indistinguishable from an empty root. Reachable today by hand-typing
  `?folder=bogus`; this change makes it reachable by a normal click.
  `workspace-documents.tsx` dropping a `folder` absent from the loaded
  folder list would close it, but that needs its own care (the folders query
  must have settled first, or it would drop a valid folder mid-load).
- **The `"folder"` parameter name is spelled in two modules** with no shared
  symbol — read with `URLSearchParams` in `workspace-documents.tsx`, written
  as a template literal here. Two call sites, both covered end-to-end by the
  browser check, so a shared helper is deferred rather than speculative.
### Applied from the PR review (CodeRabbit, PR #1013)

Both findings were valid and are fixed on the branch:

- **The Summary section still described workspace-wide prev/next.** Third
  instance of the same class — the fix corrected the Goals bullet and the
  detail bullet and walked past the one-line summary at the top.
- **A back click before `["workspaces"]` resolves landed on `/documents`,**
  losing workspace and folder both. This had been recorded below as a
  pre-existing limitation, but it is the same defect as the reported one,
  reached a different way. `useDocumentsPath` now returns `null` while that
  query is pending — an empty workspace list and one that has not arrived
  are otherwise the same shape — and the back button is disabled while Esc
  no-ops. Confirmed a discriminator: without the guard, both new tests fail
  with `expected '/documents' to be null`.
