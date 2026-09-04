# Class B — reach comments, slides, tabs, sheet images and boards without a browser

Issue: [#998](https://github.com/wafflebase/wafflebase/issues/998) — the
"B — not in the backend either (18)" row of the capability audit in
`docs/design/agentic-office-workflow.md` §3.

Class A (#999) and class A′ (#1012) are closed. Class B is the group where
**no command could close the gap**, because the backend itself has no route:
the capability exists only inside a Yorkie CRDT document that the web editor
attaches to.

## The 18 items

| Area | Items | Plan |
| --- | --- | --- |
| Comments | 6 | `/api/v1/.../documents/:id/comments`: list, create thread, reply, resolve, delete comment, delete thread |
| Slide granular editing | 5 | `POST slides` (add), `POST slides/:id/duplicate`, `DELETE slides/:id`, `POST slides/:id/move`, `GET layouts` |
| Tab rearrange | 3 | `DELETE tabs/:id`, `POST tabs/:id/move`, `POST tabs/:id/duplicate` |
| Sheet floating images | 2 | `GET`/`PUT .../tabs/:tabId/images` |
| Board | 2 | `GET`/`PUT .../content` accepts `board` |

## Steps

1. [x] Plan (this file) + design-doc status note.
2. [ ] `yorkie/comment-ops.ts` (pure) + `api/v1/comments.controller.ts` —
       sheet (`sheets[tab].comments`), doc and pdf (`root.comments`) storage.
       Author resolved from the authenticated caller; timestamps written
       through the same BigInt boundary the frontend stores use.
3. [ ] `yorkie/slide-ops.ts` (pure, over `MemSlidesStore`) +
       `api/v1/slides.controller.ts`. Persist `root.slides` only, so the
       `meta` fields `readSlidesRoot` drops are not lost.
4. [ ] `yorkie/tab-ops.ts` gains delete / move / duplicate resolutions +
       routes on `tabs.controller.ts`.
5. [ ] `yorkie/worksheet-images.ts` (`parseImages`) +
       `api/v1/worksheet-images.controller.ts`.
6. [ ] `yorkie/board-tree.ts` + a `board` arm in `docs-content.controller.ts`.
7. [ ] CLI: `comments` namespace, `slides slides|layouts`,
       `sheets tabs delete|move|duplicate`, `sheets images`,
       `board content|set-content`; one `schema/registry.ts` entry each.
8. [ ] Unit tests for every pure op + controller specs; CLI command tests.
9. [ ] Docs: `docs/design/agentic-office-workflow.md` class-B status note,
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
