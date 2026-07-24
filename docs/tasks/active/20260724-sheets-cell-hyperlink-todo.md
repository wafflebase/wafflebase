# Sheets cell hyperlinks (issue #537)

## Problem

Hyperlink formatting does not work in Sheets. Typing or pasting a URL into
a cell leaves it as plain, non-clickable text. Google Sheets auto-detects a
bare URL in a cell and renders it as a clickable blue/underlined link.

Context: issue #537 also names "Docs table" and Slides, but PR #532
("Unify hyperlink handling across Docs/Slides text boxes and tables")
already fixed the Docs table + Slides text-box/table typing paths. The
residual, unaddressed area is **Sheets**, which this task targets.

## Approach — render-time detection (no model change)

A cell is treated as a hyperlink when it holds a **plain string value**
(no formula) whose trimmed content is a single safe `http(s)://` URL.
Detection happens at render/click time, so nothing is persisted and the
`Store` interface is untouched.

- [ ] `packages/sheets/src/view/url-detect.ts` — `isSafeUrl` + `cellHyperlink(value)`
      returning the normalized URL or `null`.
- [ ] Theme: add `cellLinkColor` to Light (`#1A73E8`) / Dark (`#8AB4F8`).
- [ ] `gridcanvas.ts` `renderCellContent` — when a cell is a hyperlink,
      paint the text in the link color and underline it (respecting an
      explicit `style.tc` override).
- [ ] `worksheet.ts` `handleMouseDown` — Ctrl/Cmd+Click on a hyperlink cell
      opens it in a new tab (`window.open(..., 'noopener,noreferrer')`),
      matching the Docs Ctrl/Cmd+Click behavior.
- [ ] Unit test for `cellHyperlink` detection (safe/unsafe, formula, blanks).

## Non-goals

- No HYPERLINK()-formula click extraction (label is not a URL).
- No cell-level persisted link model / link editor UI.
- No hover link-preview chip (GS-style); Ctrl/Cmd+Click only.

## Test plan

- New unit test file for `url-detect`.
- Manual: paste a URL into a cell → blue + underline; Ctrl/Cmd+Click opens it.
