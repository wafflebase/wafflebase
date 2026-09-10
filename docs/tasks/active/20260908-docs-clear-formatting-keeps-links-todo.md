# Docs: Clear formatting must keep hyperlinks

Issue: #1051

## Problem

Selecting a range that covers a hyperlink and running **Clear formatting**
deletes the `href` along with the character formatting. `CLEAR_INLINE_STYLE`
(`packages/docs/src/model/types.ts`) lists `href: undefined` beside `bold` /
`color` / `fontSize`, and `applyInlineStyle` removes every key whose value is
`undefined`. The keyboard shortcut (`TextEditor.clearFormatting`, Cmd+\) keeps
a second, hand-rolled key list that also includes `href` — and that list has
drifted from the shared constant (it omits `fontSize` / `fontFamily` /
`color` / `backgroundColor`), so the button and the shortcut disagree.

A hyperlink is a content attribute, not character formatting. Word keeps links
through *Clear All Formatting*; removing one is the separate *Remove Hyperlink*
command, which Docs already ships as `EditorAPI.removeLink`.

## Plan

1. Drop `href` from `CLEAR_INLINE_STYLE` and say why in its doc comment.
2. Collapse `TextEditor.clearFormatting()` onto `CLEAR_INLINE_STYLE` so the
   shortcut, the toolbar button and the slides text-box entry share one key
   list. The collapsed-caret pending path uses the same constant, so it
   follows the range path by construction.
3. Refresh the `href`-mentioning contract comments on
   `EditorAPI.clearInlineFormatting`, `TextBoxEditorAPI.clearInlineFormatting`
   and the format-painter buffer.
4. Update `docs/design/docs/docs-font-controls.md` § Clear formatting — the
   note currently says "removes every inline-style attribute" and never
   discusses `href`.
5. Tests: link cases in `packages/docs/test/view/editor-clear-formatting.test.ts`
   plus the mirrored `text-box-clear-formatting.test.ts` (the docs/text-box
   pairing this area already uses for `link-trailing-edge` and
   `edit-link-in-place`).

No renderer change is needed: a link's blue + underline are derived from the
presence of `href` at paint time (`paint-layout.ts`), not stored on the run, so
a cleared link simply falls back to the default link rendering.

## Acceptance criteria

- [ ] Clear formatting over a range covering a link keeps the `href`.
- [ ] Clear formatting still wipes bold/italic/underline/color/size, including
      a custom colour or underline authored on the linked run.
- [ ] Toolbar button and Cmd+\ shortcut behave identically.
- [ ] Same behaviour in the slides text-box editor.
- [ ] `removeLink` is still the way to drop a hyperlink.
