/**
 * The one walk that decides which style a *collapsed caret* carries.
 *
 * The range side of this question already has a single traversal
 * (`visitRangeSlices` / `visitStyledRunsInRange`); the caret side used to be
 * hand-copied into every editor — `view/editor.ts`, `view/text-editor.ts` and
 * `view/text-box-editor.ts` — and the copies drifted. That drift is exactly
 * how issue #715 reached the text-box editor: the caret read returned the raw
 * run style while the range summary reported the *effective* one, so the
 * toolbar saw "not italic" inside a Heading 6 and applying italic was a
 * permanent visual no-op.
 *
 * `withStyleDefaults` is the one axis the callers genuinely differ on:
 *
 *  - **true** — the block's named-style inline defaults layered *under* the
 *    run's explicit style, i.e. what the renderer paints. Use it to *present*
 *    or to *decide* (toolbar pickers, add-vs-remove).
 *  - **false** (default) — the raw run style. Use it whenever the result is
 *    *stored* (pending style, style application): baking a named-style default
 *    into a run breaks the lazy cascade when the style is later redefined.
 */
import type { DocPosition, InlineStyle } from './types.js';
import { blockStyleId, resolveStyleInline } from './named-styles.js';
import type { Doc } from './document.js';

/**
 * Named-style inline defaults of the block holding `position` — the layer the
 * renderer paints under each run's explicit style. Exposed separately for
 * callers that need the raw run style *and* the defaults as distinct layers.
 */
export function caretStyleDefaults(
  doc: Doc,
  position: DocPosition,
): Partial<InlineStyle> {
  // `findBlock` walks body + header + footer + table cells, so a caret in a
  // header/footer or cell block resolves too (a body-only lookup returned {}).
  const block = doc.findBlock(position.blockId);
  if (!block) return {};
  // Deliberately resolved on the *light* surface (no third argument) even when
  // the editor is in dark mode. This module describes the document — what the
  // toolbar reports and what "Update <style> to match" captures — not what is
  // on screen. Passing the dark surface here would persist `#B0B0B0` into the
  // CRDT registry as if the user had chosen it, which would then paint in light
  // mode and in every export. See `resolveStyleInline`.
  //
  // What this does *not* do is decide what gets stored. The capture is the
  // computed style, so it carries the built-in's own grey for a run that never
  // set a color; `omitBuiltinStyleDefaults` (called by `updateStyleToMatch`) is
  // what drops it again. Reading the light surface here and storing the result
  // verbatim was the shipped bug: it froze `#434343` onto Heading 3 whenever
  // anyone updated the style to match, killing the dark layer.
  return resolveStyleInline(blockStyleId(block), doc.document.styles);
}

/**
 * Read the inline style of the run the caret sits in. See the module comment
 * for when to pass `withStyleDefaults`.
 */
export function caretInlineStyle(
  doc: Doc,
  position: DocPosition,
  withStyleDefaults = false,
): Partial<InlineStyle> {
  const block = doc.findBlock(position.blockId);
  if (!block) return {};
  // Light surface on purpose — same invariant, and same caveat, as
  // `caretStyleDefaults` above.
  const defaults = withStyleDefaults
    ? resolveStyleInline(blockStyleId(block), doc.document.styles)
    : undefined;
  let pos = 0;
  for (const inline of block.inlines) {
    const inlineEnd = pos + inline.text.length;
    if (position.offset <= inlineEnd) {
      return { ...defaults, ...inline.style };
    }
    pos = inlineEnd;
  }
  const last = block.inlines[block.inlines.length - 1];
  return last ? { ...defaults, ...last.style } : { ...defaults };
}
