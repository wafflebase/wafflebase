# Lessons

- IME bug fixes must validate both entry routing and caret/selection mutation timing.
  If composition starts on the first keystroke, avoid forcing selection ranges on an
  empty `contenteditable` before IME establishes its composition session.
- For spreadsheet UX, "selected but not editing" can still keep a hidden input
  focused (primed mode). Then route non-text keys through grid keymaps and let
  native text/composition events promote to visible editing.
- When writing commit messages via shell, do not put `\n` inside regular quoted
  `-m` strings (`"..."`). Use multiple `-m` flags, `$'...'`, or an editor/file
  so line breaks are real newlines, not literal backslash-n text.
