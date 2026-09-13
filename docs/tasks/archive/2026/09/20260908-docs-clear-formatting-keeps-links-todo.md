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

- [x] Clear formatting over a range covering a link keeps the `href`.
      **v0.6.10 audit — verified by reading the code:** `packages/docs/src/model/types.ts:300` `CLEAR_INLINE_STYLE` — 14 keys, no `href`; decision recorded at :283-298. Tests `test/view/editor-clear-formatting.test.ts:179,211`.
- [x] Clear formatting still wipes bold/italic/underline/color/size, including
      a custom colour or underline authored on the linked run.
      **v0.6.10 audit — verified by reading the code:** same literal, `types.ts:301-314`: bold/italic/underline/underlineStyle/underlineColor/strikethrough/strikeStyle/letterSpacing/fontSize/fontFamily/color/backgroundColor/superscript/subscript all `undefined`.
- [x] Toolbar button and Cmd+\ shortcut behave identically.
      **v0.6.10 audit — verified by reading the code:** both read the one constant: `view/editor.ts:3573` and `view/text-editor.ts:3541` → :3555 / :3560. The drifted hand-rolled list is gone (comment :3535-3539).
- [x] Same behaviour in the slides text-box editor.
      **v0.6.10 audit — verified by reading the code:** `packages/docs/src/view/text-box-editor.ts:1124`. Tests `test/view/text-box-clear-formatting.test.ts:143,230`.
- [x] `removeLink` is still the way to drop a hyperlink.
      **v0.6.10 audit — verified by reading the code:** `view/editor.ts:218`/:3951 and `view/text-box-editor.ts:314`/:1278. Tests `text-box-clear-formatting.test.ts:158,168,185`.
