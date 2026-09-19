# Class B — reach comments, slides, tabs, sheet images and boards without a browser

Issue: [#998](https://github.com/wafflebase/wafflebase/issues/998) — the
"B — not in the backend either (18)" row of the capability audit in
`docs/design/agent-pipeline/agentic-office-workflow.md` §3.

Class A (#999) and class A′ (#1012) are closed. Class B is the group where
**no command could close the gap**, because the backend itself has no route:
the capability exists only inside a Yorkie CRDT document that the web editor
attaches to.

## The 18 items

| Area | Items | Plan |
| --- | --- | --- |
| Comments | 6 | `/api/v1/.../documents/:id/comments`: list, create thread, reply, resolve, delete comment, delete thread |
| Slide granular editing | 5 | `POST slides` (add), `POST slides/:id/duplicate`, `DELETE slides/:id`, `POST slides/:id/move`, `GET layouts` |
| Tab rearrange | 3 | `DELETE tabs/:id`, `POST tabs/:id/reorder` (`move` is taken by the row/column axis move one segment deeper), `POST tabs/:id/duplicate` |
| Sheet floating images | 2 | `GET`/`PUT .../tabs/:tabId/images` |
| Board | 2 | `GET`/`PUT .../content` accepts `board` |

## Steps

> **v0.6.10 audit — the markers changed, the claims did not.** These steps were
> written as an ordered list (`1. [x]`), which `scripts/tasks-archive.mjs` could
> not see: its `uncheckedTodoPattern` required a `-` bullet, so a task with eight
> open steps read to the tooling as a task with none, and the next
> `pnpm tasks:archive` would have filed it as finished. The scanner now accepts
> every CommonMark list marker, and these steps are rewritten as bullets so the
> two agree. Steps 2–8 are ticked because the code was found and read (evidence
> inline); step 1 is **un**ticked and step 9 stays open, because the design-doc
> status note both of them promise does not exist.

- [ ] Plan (this file) + design-doc status note. The plan half is done — this
      file. The status-note half is not, and it is the same artifact step 9
      asks for, so this box cannot be ticked until step 9 is:
      `docs/design/agent-pipeline/agentic-office-workflow.md:215` still states in the present
      tense that there is "No comment controller under `/api/v1`", which has
      been false since #1022 merged.
- [x] `yorkie/comment-ops.ts` (pure) + `api/v1/comments.controller.ts` —
      sheet (`sheets[tab].comments`), doc and pdf (`root.comments`) storage.
      Author resolved from the authenticated caller; timestamps written
      through the same BigInt boundary the frontend stores use.
- [x] `yorkie/slide-ops.ts` (pure, over `MemSlidesStore`) +
      `api/v1/slides.controller.ts`. Persist `root.slides` only, so the
      `meta` fields `readSlidesRoot` drops are not lost.
- [x] `yorkie/tab-ops.ts` gains delete / move / duplicate resolutions +
      routes on `tabs.controller.ts`.
- [x] `yorkie/worksheet-images.ts` (`parseImages`) +
      `api/v1/worksheet-images.controller.ts`.
- [x] `yorkie/board-tree.ts` + a `board` arm in `docs-content.controller.ts`.
- [x] CLI: `comments` namespace, `slides slides|layouts`,
      `sheets tabs delete|move|duplicate`, `sheets images`,
      `board content|set-content`; one `schema/registry.ts` entry each.
- [x] Unit tests for every pure op + controller specs; CLI command tests.
- [ ] Docs: `docs/design/agent-pipeline/agentic-office-workflow.md` class-B status note,
      `docs/design/cli.md`, `docs/design/rest-api.md`,
      `packages/backend/README.md`, `packages/cli/README.md` if it lists
      commands.

## Decisions

- **Docs comment threads cannot be created through the API.** A
  `docs-range` anchor is a `TreePosStructRange` — a pair of CRDT positions
  only a live editor session can mint. Listing, replying, resolving and
  deleting work on docs threads; `POST` refuses with a 400 that says why.
  Sheet (`A1` ref → axis ids) and PDF (page + normalized rect) anchors are
  constructible from outside, so those create.
- **Deleting a tab refuses rather than cascades.** The web editor deletes
  the pivot tabs that depend on the tab being removed, after a confirm
  dialog. An API caller has no dialog, so a dependent pivot output tab is a
  `409` naming it; the caller deletes it first if that is what they meant.
- **Slide ops round-trip through `MemSlidesStore`** rather than
  reimplementing placeholder seeding, id regeneration and connector-endpoint
  remapping. Only `root.slides` is written back.
