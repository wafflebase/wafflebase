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
import type { AutofitMode, Frame, VerticalAnchorMode } from '../../model/element';
import { computeAutofitScale, scaleBlocks } from '../../model/autofit';

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
  applyStyle(style: Partial<InlineStyle>): void;
  applyBlockStyle(style: Partial<BlockStyle>): void;
  getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number };
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
  const { overlay, frame, scale, blocks, onCommit, onCancel, onLinkRequest, onContentHeightChange, colorResolver, autofit, verticalAnchor } = opts;

  // Auto-grow is the behavior for every mode except an explicit 'shrink'
  // (fixed box, font scales) or 'none' (fixed box, overflow). Absent ⇒
  // grow, matching the pre-autofit default so existing decks keep growing.
  const isGrow = autofit !== 'shrink' && autofit !== 'none';
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
    // Grow only when the mode calls for it. For 'shrink'/'none' the box
    // stays fixed, so we leave this unwired and the docs editor never
    // resizes the surface.
    onContentHeightChange: isGrow
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
          onContentHeightChange?.(targetH);
        }
      : undefined,
    // Shrink: scale fonts down so content fits the fixed box, live as the
    // user types. The same scale is applied in the committed renderer
    // (text-renderer.ts) so the editing surface stays pixel-identical.
    transformLayoutBlocks: isShrink
      ? (bs): Block[] => {
          try {
            const s = computeAutofitScale(bs, autofitMeasurer, frame.w, frame.h, 0);
            return s === 1 ? bs : scaleBlocks(bs, s);
          } catch {
            // Measurement unavailable (e.g. a canvas-less headless env);
            // fall back to unscaled blocks rather than failing the mount.
            return bs;
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
    applyStyle(style: Partial<InlineStyle>): void {
      api.applyStyle(style);
    },
    applyBlockStyle(style: Partial<BlockStyle>): void {
      api.applyBlockStyle(style);
    },
    getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number } {
      return api.getBlockType();
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
