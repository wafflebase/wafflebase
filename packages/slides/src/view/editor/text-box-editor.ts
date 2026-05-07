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
  type Block,
  type TextBoxEditorAPI,
} from '@wafflebase/docs';
import type { Frame } from '../../model/element';

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
}

export function mountSlidesTextBox(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
  const { overlay, frame, scale, blocks, onCommit, onCancel } = opts;

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
  // Logical pixels match the slide frame so findPositionAtPixel math
  // stays identity-aligned (no extra scale layer inside the editor).
  // The visual size matches frame * scale via CSS so the canvas pixels
  // map 1:1 to host pixels.
  canvas.width = Math.max(1, Math.round(frame.w * scale));
  canvas.height = Math.max(1, Math.round(frame.h * scale));
  canvas.style.width = `${frame.w * scale}px`;
  canvas.style.height = `${frame.h * scale}px`;
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

  const api: TextBoxEditorAPI = initializeTextBox({
    container,
    canvas,
    blocks,
    // The text-box editor expects logical pixels for content sizing.
    // We pass the host-pixel width because we sized the canvas to host
    // pixels above (so the layout math stays in pixel-perfect host
    // space, no extra scale layer inside the docs editor).
    contentWidth: Math.max(1, Math.round(frame.w * scale)),
    contentHeight: Math.max(1, Math.round(frame.h * scale)),
    onCommit: handleCommit,
    onCancel: handleCancel,
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
  };
}
