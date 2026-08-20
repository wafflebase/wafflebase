# Lessons — frame protocol (PR 10a, #855)

## A stamp id has to be globally unique, and `<root>:<path>` is not

A scene mounted inside the app shell paints the layout, the sidebar, the nav and the page into
ONE document, and `Page` / `default` are common root names — two files easily both contribute
`Page:0.1`. Keying selection on the bare stamp highlighted a node in the wrong file. The id
carries the file for that reason.

## The alias table belongs to the consumer, and asking for it is one line

The prototype resolved every path against `packages/frontend/src`. The plugin reads Vite's own
`resolve.alias` instead, so a project whose alias is `~` or `#app` needs no editor
configuration at all — and the fixture consumer proves it by using `@` → `app/`, not `src/`.
