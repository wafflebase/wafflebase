/**
 * Slides-side wrapper around `initializeTextBox` from @wafflebase/docs.
 *
 * Builds a per-textbox container + canvas inside the slides editor's
 * existing selection overlay, positioned to the text element's frame
 * (`frame * scale`), then hands off the rich-text editing surface to
 * `initializeTextBox`. Routes commit/cancel back to the editor.
 *
 * The container is positioned absolutely inside the overlay (which the
 * slides editor already manages); its `pointer-events` are enabled so
 * clicks land on the text-box rather than passing through to the
 * canvas underneath. The canvas backing the text-box uses the same
 * logical width/height as the slide-frame in slide-coords, but its
 * actual host pixel size is `frame * scale` so 1 logical pixel inside
 * the text editor maps to 1 host pixel — keeping `findPositionAtPixel`
 * math identity-aligned with the rendered glyphs.
 *
 * No CRDT here yet — that's T5. The wrapper just calls onCommit with
 * the new Block[] snapshot; the editor writes it back through
 * `store.withTextElement`.
 *
 * Refs: docs/tasks/active/20260507-slides-phase5a-plan.md Task 4.
 */
import {
  initializeTextBox,
  CanvasTextMeasurer,
  type Block,
  type TextBoxEditorAPI,
  type InlineStyle,
  type BlockStyle,
  type BlockType,
  type HeadingLevel,
  type ColorResolver,
} from '@wafflebase/docs';
import type { AutofitMode, Element, Frame, VerticalAnchorMode } from '../../model/element';
import { computeAutofitScale, scaleBlocks } from '../../model/autofit';

/**
 * Logical-px inset applied to a text-capable element's frame when
 * computing the cursor "text region" for hover feedback. Purely a
 * cursor affordance — does NOT influence where the contenteditable
 * mounts (the box still uses the full frame).
 */
export const HOVER_TEXT_REGION_INSET_PX = 6;

/**
 * Compute the text-region rectangle for a text-capable element. Returns
 * the frame inset by HOVER_TEXT_REGION_INSET_PX on every side, or null
 * if the element does not have a text body.
 *
 * Used by cursor hover feedback to distinguish between the "text region"
 * and the border padding of a selected text-capable element.
 */
export function getTextRegionRect(
  element: Element,
  frame: Frame,
): { x: number; y: number; w: number; h: number } | null {
  let hasTextBody = false;
  if (element.type === 'text') {
    hasTextBody = true;
  } else if (element.type === 'shape') {
    const text = (element.data as { text?: unknown }).text;
    hasTextBody =
      text !== undefined &&
      Array.isArray((text as { blocks?: unknown }).blocks) &&
      (text as { blocks: unknown[] }).blocks.length > 0;
  } else if (element.type === 'table') {
    // Every TableCell carries a TextBody; the cursor I-beam should
    // engage over the entire table in P1. Cell-level routing (different
    // I-beam region per cell, distinct hit-test for cell borders) is
    // wired alongside cell-range selection in P3.
    hasTextBody = true;
  }
  if (!hasTextBody) return null;
  const w = Math.max(0, frame.w - 2 * HOVER_TEXT_REGION_INSET_PX);
  const h = Math.max(0, frame.h - 2 * HOVER_TEXT_REGION_INSET_PX);
  if (w === 0 || h === 0) return null;
  return {
    x: frame.x + HOVER_TEXT_REGION_INSET_PX,
    y: frame.y + HOVER_TEXT_REGION_INSET_PX,
    w,
    h,
  };
}

/**
 * Measurer for the live "shrink" scale computation. Module-scope so its
 * font-metrics cache is shared across edit sessions; one mount lives only
 * as long as one edit session, so there's no per-instance state to leak.
 */
const autofitMeasurer = new CanvasTextMeasurer();

export interface MountSlidesTextBoxOptions {
  /** The slides editor's selection overlay. The wrapper appends a child container. */
  overlay: HTMLDivElement;
  /** Element frame in slide-logical (1920×1080) coordinates. */
  frame: Frame;
  /** Host pixels per logical slide pixel. */
  scale: number;
  /** Initial content. */
  blocks: Block[];
  /** Called on blur with the new Block[]. The editor commits via store.withTextElement. */
  onCommit: (blocks: Block[]) => void;
  /** Called when Escape is pressed (BEFORE onCommit fires via the blur path). */
  onCancel: () => void;
  /**
   * Called when the user presses Cmd/Ctrl+K. The slides shell opens a
   * link popover anchored near the caret. Forwarded straight through
   * to the docs text-box, which wires it to the inner `TextEditor`.
   */
  onLinkRequest?: () => void;
  /**
   * Fired (logical px) when the docs editor's content height changes.
   * The wrapper has already resized its container/canvas and called
   * `setContentHeight` by the time this fires; the slides editor uses it
   * to persist the fitted frame height at commit time.
   */
  onContentHeightChange?: (contentHeight: number) => void;
  /**
   * Autofit mode of the text element. Drives which behavior the editor
   * wires:
   * - 'shrink' → fonts auto-scale down to fit the fixed box
   *   (`transformLayoutBlocks`); the box does NOT auto-grow.
   * - 'grow' (and absent, the pre-autofit default) → box height tracks
   *   content via `onContentHeightChange`.
   * - 'none' → fixed box, no scaling, text overflows.
   */
  autofit?: AutofitMode;
  /**
   * Override `autofit`'s default canvas-grow behavior. The docs
   * text-box normally grows its canvas to fit content for both `'grow'`
   * and `'none'` autofit so live typing isn't clipped (`'shrink'`
   * scales fonts instead). For shape inline text that growth breaks
   * vertical-anchor alignment: the editor canvas shrinks to text height
   * and anchors at originY=0, while the renderer keeps the original
   * inner-frame height and anchors text in the middle — producing a
   * visible "jump" between editing and committed positions.
   *
   * Set `'never'` to force the editor canvas to stay at the mount-time
   * `frame.h`. Text overflows during typing identically to how it
   * overflows after commit, and the middle/bottom anchors keep their
   * intended position. Use for shape text editing; leave undefined for
   * text elements (preserves the prior auto-grow behavior).
   */
  growMode?: 'auto' | 'never';
  /**
   * Vertical anchor of the text element. Forwarded to the docs text-box
   * editor so the in-place editor positions text at the same y as the
   * committed slide canvas. Mirrors OOXML `<a:bodyPr anchor>`. Absent ⇒
   * top, matching pre-feature behaviour.
   */
  verticalAnchor?: VerticalAnchorMode;
  /**
   * Theme-aware color resolver built from the deck's active theme (see
   * `makeColorResolver` in the canvas text-renderer). Forwarded to the
   * docs text-box so in-place editing paints text in the same theme
   * color as the committed slide canvas. Omitted → docs default (literal
   * strings), which renders dark-theme text as black.
   */
  colorResolver?: ColorResolver;
  /**
   * Deck-level pre-scale (from `deckFontScale(meta)`). Composed into
   * `transformLayoutBlocks` so the in-place editor renders text at the
   * same px size as the committed slide canvas. Absent / `1` ⇒ docs
   * default 96-DPI conversion only.
   */
  fontScale?: number;
  /**
   * P2.6 — Optional text to insert at the caret on the first `focus()`
   * call. Used by the type-to-edit keyboard rule so the printable key
   * that triggered the entry actually lands in the freshly-mounted box
   * (otherwise the user has to retype it). Inserted exactly once; later
   * `focus()` calls are unaffected.
   *
   * See docs/design/slides/slides-hover-and-text-edit-entry.md § P2.6.
   */
  initialText?: string;
}

export interface SlidesTextBoxEditor {
  /** Returns true while the underlying TextBoxEditorAPI is mounted. */
  isEditing(): boolean;
  /** Programmatic focus into the hidden textarea. */
  focus(): void;
  /**
   * Tear down: detach the docs text-box, remove the container from
   * the overlay. Does NOT trigger commit by itself — call `commit()`
   * first or rely on the blur path before detach.
   * Idempotent.
   */
  detach(): void;
  /**
   * Force a commit + detach. Useful for the editor's "click outside"
   * path where the user moved focus without blurring the textarea.
   */
  commit(): void;
  /**
   * The container DOM node (so the slides editor can hit-test
   * "click inside the editing text-box vs outside" cheaply).
   */
  readonly container: HTMLDivElement;

  // ─── Text-formatting surface (mirrors TextBoxEditorAPI) ───────────────────
  // Delegated straight through to the underlying docs TextBoxEditorAPI so
  // shared text-formatting toolbar components can drive the slides text-box
  // editor via the same `TextFormattingEditor` interface as the docs editor.

  getSelectionStyle(): Partial<InlineStyle>;
  getRangeStyleSummary(): {
    bold?: boolean | 'mixed';
    italic?: boolean | 'mixed';
    underline?: boolean | 'mixed';
    strikethrough?: boolean | 'mixed';
    fontFamily?: string | 'mixed';
    fontSize?: number | 'mixed';
    color?: InlineStyle['color'] | 'mixed';
    backgroundColor?: InlineStyle['backgroundColor'] | 'mixed';
    superscript?: boolean | 'mixed';
    subscript?: boolean | 'mixed';
  };
  applyStyle(style: Partial<InlineStyle>): void;
  clearInlineFormatting(): void;
  applyBlockStyle(style: Partial<BlockStyle>): void;
  getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number };
  getBlockStyle(): Partial<BlockStyle>;
  setBlockType(type: BlockType, opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number }): void;
  toggleList(kind: 'ordered' | 'unordered'): void;
  indent(): void;
  outdent(): void;
  insertLink(url: string): void;
  removeLink(): void;
  getLinkAtCursor(): string | undefined;
  requestLink(): void;
  undo(): void;
  redo(): void;
  onCursorMove(cb: (pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null) => void): void;
}

export function mountSlidesTextBox(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
  const { overlay, frame, scale, blocks, onCommit, onCancel, onLinkRequest, onContentHeightChange, colorResolver, autofit, verticalAnchor, growMode, initialText } = opts;
  // Deck-level font pre-scale (from `deckFontScale(meta)`). Composed
  // ahead of shrink-autofit so the editor reads the same effective
  // font size the committed canvas paints. Defaults to `1` so existing
  // call sites that don't pass this opt keep the prior behavior.
  const fontScale = opts.fontScale ?? 1;
  const needsDeckScale = fontScale !== 1;

  // Two related but separate flags:
  // - allowEditorGrow: the editing canvas grows to fit content while the
  //   user types. 'grow' and 'none' both opt in; only 'shrink' keeps the
  //   editing surface fixed (it scales fonts instead). A `growMode:
  //   'never'` opt-in forces this off — used for shape inline text where
  //   the canvas must stay at the mount-time height so vertical-anchor
  //   math agrees with the post-commit renderer (otherwise the editor
  //   shrinks the canvas to text height + originY=0 and the renderer
  //   anchors text in the middle of the unchanged inner frame, producing
  //   a visible "jump" between edit and committed positions).
  // - isGrow: the grown height is committed back to frame.h on exit. Only
  //   true autofit-grow does this; 'none' shows overflow live but keeps
  //   the saved box, so post-commit the slide renderer paints the overflow
  //   below the frame just as it did before the edit.
  const allowEditorGrow = growMode === 'never' ? false : autofit !== 'shrink';
  const isGrow = autofit !== 'shrink' && autofit !== 'none' && growMode !== 'never';
  const isShrink = autofit === 'shrink';

  // Container positioned over the element frame in host-pixel space.
  const container = document.createElement('div');
  container.className = 'wfb-slides-text-box-editor';
  container.style.position = 'absolute';
  container.style.left = `${frame.x * scale}px`;
  container.style.top = `${frame.y * scale}px`;
  container.style.width = `${frame.w * scale}px`;
  container.style.height = `${frame.h * scale}px`;
  // Capture pointer events so clicks land on the text-box (the overlay
  // itself has `pointer-events: none`; we re-enable them on the editing
  // container so it intercepts clicks before they reach the slide canvas).
  container.style.pointerEvents = 'auto';
  // Match handle outline so users see they're in edit mode.
  container.style.outline = '1px dashed #3a7';
  container.style.outlineOffset = '0';
  // Apply rotation if the element is rotated. Rotation is around the
  // frame center — same convention as the slide renderer.
  if (frame.rotation !== 0) {
    container.style.transform = `rotate(${frame.rotation}rad)`;
    container.style.transformOrigin = 'center';
  }
  overlay.appendChild(container);

  const canvas = document.createElement('canvas');
  // CSS size (host pixels) = frame * scale; bitmap pixel size also
  // accounts for devicePixelRatio so high-DPI displays paint at native
  // resolution instead of being upscaled by the browser (which would
  // produce blurry text). The text-box editor's paint path then scales
  // its draws by `dpr` so logical text-box coords still map 1:1 to host
  // CSS pixels.
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const cssW = Math.max(1, Math.round(frame.w * scale));
  const cssH = Math.max(1, Math.round(frame.h * scale));
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.display = 'block';
  container.appendChild(canvas);

  let mounted = true;
  let committedAlready = false;
  // P2.6 — `initialText` is forwarded into the docs editor exactly once,
  // on the first `focus()` call after mount. Tracked here so re-focusing
  // a long-lived edit session (e.g. focus toggling during a toolbar
  // click) doesn't re-inject the same character.
  let initialTextPending = initialText !== undefined && initialText !== '';

  const handleCommit = (next: Block[]): void => {
    if (committedAlready) return;
    committedAlready = true;
    onCommit(next);
  };

  const handleCancel = (): void => {
    onCancel();
  };

  // NOTE: the `onContentHeightChange` callback below references `api`. That
  // is safe only because `initializeTextBox` never fires it synchronously
  // during construction — its first paint goes through `requestRender()`
  // (rAF/microtask), so the callback always runs after this `const` binds.
  // If the docs editor ever fires it synchronously, forward-declare `api`.
  const api: TextBoxEditorAPI = initializeTextBox({
    container,
    canvas,
    blocks,
    // Pass the LOGICAL slide-frame dimensions as content size (not the
    // host-CSS-scaled values). This keeps the editor's text rendered
    // at the same logical font sizes the slide canvas uses, so
    // committed text on the slide canvas matches what the user saw
    // while editing — no font-size jump on commit.
    //
    // The effective `dpr` we pass is `browser dpr * slide scale`:
    // the docs text-box scales its ctx by this, mapping logical
    // coords (contentWidth) onto the device-pixel canvas bitmap
    // (`cssW * browser dpr` = `frame.w * scale * browser dpr`).
    contentWidth: frame.w,
    contentHeight: frame.h,
    dpr: dpr * scale,
    // The container CSS size is `frame * scale` host pixels but
    // `contentWidth/Height` are in logical pixels — pass `scale` so the
    // docs editor's pointer math divides clicks back into the logical
    // coord space `run.x` lives in. Without this, clicks at scale != 1
    // land at offset 0 (especially visible with center/right alignment
    // because `localX < firstRun.x` snaps to the start of the line).
    scale,
    onCommit: handleCommit,
    onCancel: handleCancel,
    onLinkRequest,
    // Grow the editor surface for both 'grow' and 'none' modes so the
    // text the user is typing never gets clipped. 'shrink' keeps the
    // surface fixed because it scales fonts instead (transformLayoutBlocks
    // below). Only 'grow' propagates the new height back to frame.h —
    // 'none' shows the overflow live during edit and leaves the saved box
    // alone so the post-commit render matches the pre-edit frame.
    onContentHeightChange: allowEditorGrow
      ? (h: number): void => {
          // Grow/shrink the editing surface to fit content. Width is fixed;
          // only height tracks. cssH is host pixels (logical * slide scale);
          // the canvas bitmap also multiplies by the browser dpr captured at
          // mount. Setting canvas.height resets the bitmap — setContentHeight
          // then schedules a repaint at the new size.
          const targetH = Math.max(1, h);
          const cssH = Math.max(1, Math.round(targetH * scale));
          container.style.height = `${cssH}px`;
          canvas.style.height = `${cssH}px`;
          canvas.height = Math.max(1, Math.round(cssH * dpr));
          api.setContentHeight(targetH);
          if (isGrow) onContentHeightChange?.(targetH);
        }
      : undefined,
    // Layout-block transform chain:
    //   1. Pre-scale by the deck's `fontScale` so 52 pt occupies the
    //      same px proportion as the committed canvas (PPTX decks at
    //      non-default physical sizes).
    //   2. Then, for `shrink` autofit, scale fonts further to fit the
    //      fixed box. Same composition runs in `paintTextBody`, keeping
    //      the editing surface pixel-identical to the committed paint.
    transformLayoutBlocks:
      needsDeckScale || isShrink
        ? (bs): Block[] => {
            const deckScaled = needsDeckScale ? scaleBlocks(bs, fontScale) : bs;
            if (!isShrink) return deckScaled;
            try {
              const s = computeAutofitScale(
                deckScaled,
                autofitMeasurer,
                frame.w,
                frame.h,
                0,
              );
              return s === 1 ? deckScaled : scaleBlocks(deckScaled, s);
            } catch {
              // Measurement unavailable (e.g. a canvas-less headless env);
              // fall back to deck-scaled blocks rather than failing the mount.
              return deckScaled;
            }
          }
        : undefined,
    colorResolver,
    verticalAnchor,
  });

  return {
    isEditing(): boolean {
      return mounted;
    },
    focus(): void {
      api.focus();
      // P2.6 — Forward the printable key that triggered text-edit entry
      // via the typed `api.insertText`, which routes through
      // `TextEditor.docInsertText` at the current caret position. The
      // flag is consumed BEFORE the call so a re-entrant focus()
      // triggered by handleFocus/render side effects doesn't re-inject;
      // it is restored if the call throws so a later `focus()` can retry.
      // Was previously a textarea + synthetic `input` hack — brittle to
      // future `inputType` gating, racy against the textarea lookup, and
      // it routed a lone Hangul jamo through the software-Hangul
      // assembler (starting an unintended composition). See findings #6,
      // #7, #8 in the code-review report on this PR.
      if (initialTextPending && initialText !== undefined && initialText !== '') {
        initialTextPending = false;
        try {
          api.insertText(initialText);
        } catch (err) {
          // Restore the flag so a follow-up focus() can retry; surface the
          // error for diagnosis rather than silently dropping the key.
          initialTextPending = true;
          throw err;
        }
      }
    },
    commit(): void {
      // Trigger commit via blur (the docs text-box wires onCommit to
      // the focusout path). If the textarea is already blurred,
      // committedAlready guards against duplicate fires.
      api.blur();
    },
    detach(): void {
      if (!mounted) return;
      mounted = false;
      api.detach();
      container.remove();
    },
    container,

    // ── Formatting surface — delegate straight through to docs TextBoxEditorAPI ─
    getSelectionStyle(): Partial<InlineStyle> {
      return api.getSelectionStyle();
    },
    getRangeStyleSummary() {
      return api.getRangeStyleSummary();
    },
    applyStyle(style: Partial<InlineStyle>): void {
      api.applyStyle(style);
    },
    clearInlineFormatting(): void {
      api.clearInlineFormatting();
    },
    applyBlockStyle(style: Partial<BlockStyle>): void {
      api.applyBlockStyle(style);
    },
    getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number } {
      return api.getBlockType();
    },
    getBlockStyle(): Partial<BlockStyle> {
      return api.getBlockStyle();
    },
    setBlockType(type: BlockType, opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number }): void {
      api.setBlockType(type, opts);
    },
    toggleList(kind: 'ordered' | 'unordered'): void {
      api.toggleList(kind);
    },
    indent(): void {
      api.indent();
    },
    outdent(): void {
      api.outdent();
    },
    insertLink(url: string): void {
      api.insertLink(url);
    },
    removeLink(): void {
      api.removeLink();
    },
    getLinkAtCursor(): string | undefined {
      return api.getLinkAtCursor();
    },
    requestLink(): void {
      api.requestLink();
    },
    undo(): void {
      api.undo();
    },
    redo(): void {
      api.redo();
    },
    onCursorMove(cb: (pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null) => void): void {
      api.onCursorMove(cb);
    },
  };
}
