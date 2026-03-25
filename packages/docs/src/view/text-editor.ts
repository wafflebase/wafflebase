import type { DocPosition, InlineStyle, HeadingLevel } from '../model/types.js';
import { getBlockText, getBlockTextLength } from '../model/types.js';
import { Doc } from '../model/document.js';
import { Cursor } from './cursor.js';
import { Selection } from './selection.js';
import type { DocumentLayout } from './layout.js';
import type { PaginatedLayout } from './pagination.js';
import { paginatedPixelToPosition, findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import { buildFont } from './theme.js';
import { HangulAssembler, isJamo, type HangulResult } from './hangul.js';
import { findNextWordBoundary, findPrevWordBoundary, getWordRange } from './word-boundary.js';
import { findVisualLine } from './visual-line.js';

/**
 * Composition (IME) state tracker.
 *
 * During IME composition (e.g. Korean, Japanese, Chinese input),
 * text goes through intermediate states before being committed.
 * We track the composing text separately and only commit on compositionend.
 */
interface CompositionState {
  /** Whether we are currently in a composition session */
  active: boolean;
  /** Cursor position where composition started */
  startPosition: DocPosition;
  /** Length of currently composed text inserted into the model */
  currentLength: number;
}

/**
 * Input handling for the document editor.
 * Uses a hidden textarea for keyboard input capture.
 *
 * IME composition (Korean, Japanese, Chinese) is handled via
 * compositionstart/compositionend events. During composition,
 * the `input` event reads `textarea.value` to replace the preview
 * text — this works reliably across desktop and mobile Safari,
 * unlike compositionupdate which fires inconsistently on mobile.
 */
export class TextEditor {
  private textarea: HTMLTextAreaElement;
  private isMouseDown = false;
  private dragScrollRAF: number | null = null;
  private lastMouseClientY = 0;
  private clickCount = 0;
  private lastClickTime = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  private static readonly DOUBLE_CLICK_MS = 500;
  private static readonly DOUBLE_CLICK_DIST = 5;
  private composition: CompositionState = {
    active: false,
    startPosition: { blockId: '', offset: 0 },
    currentLength: 0,
  };
  /**
   * When true, all input events are ignored until the next microtask.
   * Set after compositionend to prevent post-composition duplicate insertion.
   * Unlike a simple boolean flag, the microtask-based approach catches ALL
   * synchronous input events the browser fires after compositionend (some
   * browsers fire more than one).
   */
  private ignoreInputUntilNextTick = false;

  // Software Hangul assembler for browsers that don't fire composition events
  // (e.g., Mobile Safari with hidden textarea sends raw jamo as insertText).
  private hangulAssembler = new HangulAssembler();
  private hangulStartPos: DocPosition = { blockId: '', offset: 0 };
  private hangulComposingLength = 0;
  private handleFocus: (() => void) | null = null;
  private handleBlur: (() => void) | null = null;

  constructor(
    private container: HTMLElement,
    private doc: Doc,
    private cursor: Cursor,
    private selection: Selection,
    private getLayout: () => DocumentLayout,
    private getPaginatedLayout: () => PaginatedLayout,
    private getCtx: () => CanvasRenderingContext2D,
    private getCanvasWidth: () => number,
    private getCanvasOffsetTop: () => number,
    private requestRender: () => void,
    private saveSnapshot: () => void,
    private undoAction: () => void,
    private redoAction: () => void,
    private markDirty: (blockId: string) => void,
    private invalidateLayout: () => void,
  ) {
    this.textarea = document.createElement('textarea');
    // Keep textarea within the viewport (not off-screen) so iOS IME works
    // correctly. font-size:16px prevents iOS auto-zoom on focus.
    // Use position:fixed so the browser never scrolls the container
    // to bring the textarea into view when text is entered.
    this.textarea.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;' +
      'font-size:16px;opacity:0;border:0;padding:0;margin:0;' +
      'resize:none;overflow:hidden;';
    container.appendChild(this.textarea);

    this.textarea.addEventListener('input', this.handleInput);
    this.textarea.addEventListener('keydown', this.handleKeyDown);
    this.textarea.addEventListener('compositionstart', this.handleCompositionStart);
    this.textarea.addEventListener('compositionend', this.handleCompositionEnd);
    this.textarea.addEventListener('copy', this.handleCopy);
    this.textarea.addEventListener('cut', this.handleCut);
    this.textarea.addEventListener('paste', this.handlePaste);
    container.addEventListener('mousedown', this.handleMouseDown);
    container.addEventListener('mousemove', this.handleMouseMove);
    container.addEventListener('mouseup', this.handleMouseUp);
  }

  focus(): void {
    this.textarea.focus();
  }

  /**
   * Register focus/blur callbacks on the hidden textarea.
   */
  onFocusChange(onFocus: () => void, onBlur: () => void): void {
    this.handleFocus = onFocus;
    this.handleBlur = onBlur;
    this.textarea.addEventListener('focus', this.handleFocus);
    this.textarea.addEventListener('blur', this.handleBlur);
  }

  // --- IME Composition handlers ---

  private handleCompositionStart = (): void => {
    // Cancel any pending post-compositionend ignore — a new composition is
    // starting (e.g. syllable boundary in Korean: compositionend → compositionstart).
    this.ignoreInputUntilNextTick = false;
    this.saveSnapshot();
    this.deleteSelection();
    this.composition = {
      active: true,
      startPosition: { ...this.cursor.position },
      currentLength: 0,
    };
  };

  private handleCompositionEnd = (e: CompositionEvent): void => {
    if (!this.composition.active) return;

    // Use e.data (reliable across all browsers) as the source of truth for
    // the final committed text, replacing whatever the input events put in
    // the model during composition. This corrects any drift caused by
    // browser-specific textarea.value quirks (e.g. accumulation on iOS).
    const finalText = e.data || '';
    const { startPosition, currentLength } = this.composition;

    if (currentLength > 0) {
      this.doc.deleteText(startPosition, currentLength);
    }
    if (finalText.length > 0) {
      this.doc.insertText(startPosition, finalText);
    }
    const endPos = {
      blockId: startPosition.blockId,
      offset: startPosition.offset + finalText.length,
    };
    this.markDirty(startPosition.blockId);
    this.cursor.moveTo(endPos, this.getWrapAffinity(endPos));

    this.composition.active = false;
    this.composition.currentLength = 0;
    this.requestRender();

    // Ignore ALL input events fired synchronously after compositionend.
    // A microtask runs after the current task completes, so every
    // post-compositionend input event (some browsers fire >1) is skipped.
    this.ignoreInputUntilNextTick = true;
    queueMicrotask(() => {
      this.ignoreInputUntilNextTick = false;
      // Only clear textarea if no new composition started in the meantime
      // (at a syllable boundary, compositionstart fires before this microtask).
      if (!this.composition.active) {
        this.textarea.value = '';
      }
    });
  };

  // --- Event handlers ---

  private handleInput = (): void => {
    // Ignore all input events fired synchronously after compositionend
    if (this.ignoreInputUntilNextTick) return;

    // Horizontal rules have no text content — block all input
    const currentBlock = this.doc.getBlock(this.cursor.position.blockId);
    if (currentBlock.type === 'horizontal-rule') return;

    if (this.composition.active) {
      // Browser IME path: read textarea.value which contains the current
      // composing text as managed by the browser's native IME system.
      const newText = this.textarea.value;
      const { startPosition, currentLength } = this.composition;

      if (currentLength > 0) {
        this.doc.deleteText(startPosition, currentLength);
      }
      if (newText.length > 0) {
        this.doc.insertText(startPosition, newText);
      }

      this.composition.currentLength = newText.length;
      const compPos = {
        blockId: startPosition.blockId,
        offset: startPosition.offset + newText.length,
      };
      this.markDirty(startPosition.blockId);
      this.cursor.moveTo(compPos, this.getWrapAffinity(compPos));
      this.requestRender();
      return;
    }

    const data = this.textarea.value;
    this.textarea.value = '';
    if (!data) return;

    // Software Hangul assembly: when the browser sends raw jamo without
    // composition events (Mobile Safari), assemble them into syllables.
    if (data.length === 1 && isJamo(data)) {
      const result = this.hangulAssembler.feed(data);
      this.applyHangulResult(result);
      return;
    }

    // Non-jamo input: flush any pending Hangul composition first
    this.flushHangul();

    this.saveSnapshot();
    this.deleteSelection();
    const blockId = this.cursor.position.blockId;
    this.doc.insertText(this.cursor.position, data);
    const newPos = {
      blockId: this.cursor.position.blockId,
      offset: this.cursor.position.offset + data.length,
    };
    this.markDirty(blockId);
    this.cursor.moveTo(newPos, this.getWrapAffinity(newPos));
    this.requestRender();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Don't intercept keys during IME composition
    if (this.composition.active || e.isComposing) return;

    const { ctrlKey, metaKey, shiftKey, altKey } = e;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const mod = isMac ? metaKey : ctrlKey;
    // Word-level modifier: Option on Mac, Ctrl on Windows/Linux
    const wordMod = isMac ? altKey : ctrlKey;

    // Flush software Hangul composition before processing special keys
    if (this.hangulAssembler.isComposing) {
      if (key === 'Backspace' || key === 'Delete' || key === 'Enter' ||
          key.startsWith('Arrow') || key === 'Home' || key === 'End' ||
          key === 'Escape' || mod) {
        this.flushHangul();
      }
    }

    switch (key) {
      case 'Backspace':
        e.preventDefault();
        if (isMac && metaKey) {
          this.handleLineBackspace();
        } else if (wordMod) {
          this.handleWordBackspace();
        } else {
          this.handleBackspace();
        }
        break;
      case 'Delete':
        e.preventDefault();
        if (wordMod) {
          this.handleWordDelete();
        } else {
          this.handleDelete();
        }
        break;
      case 'Enter':
        e.preventDefault();
        this.handleEnter();
        break;
      case 'Tab':
        e.preventDefault();
        this.handleTab(shiftKey);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (isMac && metaKey) {
          this.handleHome(shiftKey);
        } else {
          this.handleArrow('left', shiftKey, wordMod);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (isMac && metaKey) {
          this.handleEnd(shiftKey);
        } else {
          this.handleArrow('right', shiftKey, wordMod);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isMac && metaKey) {
          this.handleDocStart(shiftKey);
        } else {
          this.handleArrow('up', shiftKey, wordMod);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (isMac && metaKey) {
          this.handleDocEnd(shiftKey);
        } else {
          this.handleArrow('down', shiftKey, wordMod);
        }
        break;
      case 'Home':
        e.preventDefault();
        if (mod) {
          this.handleDocStart(shiftKey);
        } else {
          this.handleHome(shiftKey);
        }
        break;
      case 'End':
        e.preventDefault();
        if (mod) {
          this.handleDocEnd(shiftKey);
        } else {
          this.handleEnd(shiftKey);
        }
        break;
      case 'a':
        if (mod) {
          e.preventDefault();
          this.selectAll();
        }
        break;
      case 'b':
        if (mod) {
          e.preventDefault();
          this.toggleStyle({ bold: true });
        }
        break;
      case 'i':
        if (mod) {
          e.preventDefault();
          this.toggleStyle({ italic: true });
        }
        break;
      case 'u':
        if (mod) {
          e.preventDefault();
          this.toggleStyle({ underline: true });
        }
        break;
      case 'x':
        if (mod && shiftKey) {
          e.preventDefault();
          this.toggleStyle({ strikethrough: true });
        }
        break;
      case '\\':
        if (mod) {
          e.preventDefault();
          this.clearFormatting();
        }
        break;
      case 'z':
        if (mod) {
          e.preventDefault();
          if (shiftKey) {
            this.redoAction();
          } else {
            this.undoAction();
          }
        }
        break;
      case 'y':
        if (mod) {
          e.preventDefault();
          this.redoAction();
        }
        break;
      case '0':
        if (mod && altKey) {
          e.preventDefault();
          this.saveSnapshot();
          this.doc.setBlockType(this.cursor.position.blockId, 'paragraph');
          this.invalidateLayout();
          this.requestRender();
        }
        break;
      case '1': case '2': case '3': case '4': case '5': case '6':
        if (mod && altKey) {
          e.preventDefault();
          this.saveSnapshot();
          const level = Number(key) as HeadingLevel;
          const block = this.doc.getBlock(this.cursor.position.blockId);
          if (block && block.type === 'heading' && block.headingLevel === level) {
            this.doc.setBlockType(block.id, 'paragraph');
          } else if (block) {
            this.doc.setBlockType(block.id, 'heading', { headingLevel: level });
          }
          this.invalidateLayout();
          this.requestRender();
        }
        break;
    }
  };

  private handleCopy = (e: ClipboardEvent): void => {
    if (!this.selection.hasSelection()) return;
    e.preventDefault();
    const text = this.selection.getSelectedText(this.getLayout());
    e.clipboardData?.setData('text/plain', text);
  };

  private handleCut = (e: ClipboardEvent): void => {
    if (!this.selection.hasSelection()) return;
    e.preventDefault();
    const text = this.selection.getSelectedText(this.getLayout());
    e.clipboardData?.setData('text/plain', text);
    this.saveSnapshot();
    this.deleteSelection();
    this.requestRender();
  };

  private handlePaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;

    this.saveSnapshot();
    this.deleteSelection();

    // Split pasted text by newlines into separate blocks
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        // Create a new block for each line after the first
        this.invalidateLayout();
        const newBlockId = this.doc.splitBlock(
          this.cursor.position.blockId,
          this.cursor.position.offset,
        );
        this.cursor.moveTo({ blockId: newBlockId, offset: 0 });
      }
      if (lines[i].length > 0) {
        this.doc.insertText(this.cursor.position, lines[i]);
        const newPos = {
          blockId: this.cursor.position.blockId,
          offset: this.cursor.position.offset + lines[i].length,
        };
        this.markDirty(newPos.blockId);
        this.cursor.moveTo(newPos, this.getWrapAffinity(newPos));
      }
    }
    this.selection.setRange(null);
    this.requestRender();
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (e.target === this.textarea) return;
    e.preventDefault();
    this.flushHangul();
    this.focus();
    this.isMouseDown = true;

    // Track click count for double/triple click
    const now = Date.now();
    const dx = e.clientX - this.lastClickX;
    const dy = e.clientY - this.lastClickY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (now - this.lastClickTime < TextEditor.DOUBLE_CLICK_MS &&
        dist < TextEditor.DOUBLE_CLICK_DIST) {
      this.clickCount++;
    } else {
      this.clickCount = 1;
    }
    this.lastClickTime = now;
    this.lastClickX = e.clientX;
    this.lastClickY = e.clientY;

    const result = this.getPositionFromMouse(e);
    if (!result) return;

    const pos: DocPosition = { blockId: result.blockId, offset: result.offset };
    const { lineAffinity } = result;

    if (this.clickCount === 3) {
      // Triple-click: select entire paragraph
      const block = this.doc.getBlock(pos.blockId);
      const len = getBlockTextLength(block);
      const start: DocPosition = { blockId: pos.blockId, offset: 0 };
      const end: DocPosition = { blockId: pos.blockId, offset: len };
      this.selection.setRange({ anchor: start, focus: end });
      this.cursor.moveTo(end);
    } else if (this.clickCount === 2) {
      // Double-click: select word
      const block = this.doc.getBlock(pos.blockId);
      const text = getBlockText(block);
      const [start, end] = getWordRange(text, pos.offset);
      const anchor: DocPosition = { blockId: pos.blockId, offset: start };
      const focus: DocPosition = { blockId: pos.blockId, offset: end };
      this.selection.setRange({ anchor, focus });
      this.cursor.moveTo(focus);
    } else if (e.shiftKey) {
      // Shift+click: extend selection
      const anchor = this.selection.range?.anchor ?? this.cursor.position;
      this.selection.setRange({ anchor, focus: pos });
      this.cursor.moveTo(pos, lineAffinity);
    } else {
      // Single click
      this.cursor.moveTo(pos, lineAffinity);
      this.selection.setRange({ anchor: pos, focus: pos });
    }
    this.requestRender();
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isMouseDown || !this.selection.range) return;

    this.lastMouseClientY = e.clientY;
    this.updateDragSelection(e.clientX, e.clientY);
    this.startDragScroll();
  };

  private handleMouseUp = (): void => {
    this.isMouseDown = false;
    this.stopDragScroll();
  };

  private updateDragSelection(clientX: number, clientY: number): void {
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top - this.getCanvasOffsetTop();
    const scrollY = this.container.scrollTop;
    const result = paginatedPixelToPosition(
      this.getPaginatedLayout(), this.getLayout(), x, y + scrollY, this.getCanvasWidth(),
    );
    if (result && this.selection.range) {
      const pos: DocPosition = { blockId: result.blockId, offset: result.offset };
      this.cursor.moveTo(pos, result.lineAffinity);
      this.selection.setRange({
        anchor: this.selection.range.anchor,
        focus: pos,
      });
      this.requestRender();
    }
  }

  private startDragScroll(): void {
    if (this.dragScrollRAF !== null) return;

    const scrollStep = () => {
      if (!this.isMouseDown) {
        this.dragScrollRAF = null;
        return;
      }

      const rect = this.container.getBoundingClientRect();
      const relativeY = this.lastMouseClientY - rect.top;
      const edgeZone = 40;
      const maxSpeed = 20;

      let scrollDelta = 0;
      if (relativeY < edgeZone) {
        // Near top edge — scroll up
        const ratio = Math.max(0, (edgeZone - relativeY) / edgeZone);
        scrollDelta = -Math.ceil(ratio * maxSpeed);
      } else if (relativeY > rect.height - edgeZone) {
        // Near bottom edge — scroll down
        const ratio = Math.max(0, (relativeY - (rect.height - edgeZone)) / edgeZone);
        scrollDelta = Math.ceil(ratio * maxSpeed);
      }

      if (scrollDelta !== 0) {
        this.container.scrollTop += scrollDelta;
        this.updateDragSelection(
          this.container.getBoundingClientRect().left + 1,
          this.lastMouseClientY,
        );
      }

      this.dragScrollRAF = requestAnimationFrame(scrollStep);
    };

    this.dragScrollRAF = requestAnimationFrame(scrollStep);
  }

  private stopDragScroll(): void {
    if (this.dragScrollRAF !== null) {
      cancelAnimationFrame(this.dragScrollRAF);
      this.dragScrollRAF = null;
    }
  }

  // --- Text operations ---

  private handleBackspace(): void {
    this.saveSnapshot();
    if (this.deleteSelection()) return;
    const blockId = this.cursor.position.blockId;
    const isInBlock = this.cursor.position.offset > 0;
    if (!isInBlock) {
      this.invalidateLayout();
    }
    const newPos = this.doc.deleteBackward(this.cursor.position);
    if (isInBlock) {
      this.markDirty(blockId);
    }
    this.cursor.moveTo(newPos);
    this.requestRender();
  }

  private handleDelete(): void {
    this.saveSnapshot();
    if (this.deleteSelection()) return;
    const block = this.doc.getBlock(this.cursor.position.blockId);
    const len = getBlockTextLength(block);
    if (this.cursor.position.offset < len) {
      this.doc.deleteText(this.cursor.position, 1);
      this.markDirty(this.cursor.position.blockId);
    } else {
      // At end of block — merge with next (structural change)
      const idx = this.doc.getBlockIndex(this.cursor.position.blockId);
      if (idx < this.doc.document.blocks.length - 1) {
        const nextBlock = this.doc.document.blocks[idx + 1];
        this.invalidateLayout();
        this.doc.mergeBlocks(this.cursor.position.blockId, nextBlock.id);
      }
    }
    this.requestRender();
  }

  private handleWordBackspace(): void {
    this.saveSnapshot();
    if (this.deleteSelection()) return;
    const pos = this.cursor.position;
    if (pos.offset > 0) {
      const text = getBlockText(this.doc.getBlock(pos.blockId));
      const boundary = findPrevWordBoundary(text, pos.offset);
      const count = pos.offset - boundary;
      this.doc.deleteText({ blockId: pos.blockId, offset: boundary }, count);
      this.cursor.moveTo({ blockId: pos.blockId, offset: boundary });
      this.markDirty(pos.blockId);
    } else {
      // At start of block — merge with previous (same as normal backspace)
      if (this.doc.getBlockIndex(pos.blockId) === 0) return;
      this.invalidateLayout();
      const newPos = this.doc.deleteBackward(pos);
      this.cursor.moveTo(newPos);
    }
    this.requestRender();
  }

  private handleWordDelete(): void {
    this.saveSnapshot();
    if (this.deleteSelection()) return;
    const pos = this.cursor.position;
    const block = this.doc.getBlock(pos.blockId);
    const len = getBlockTextLength(block);
    if (pos.offset < len) {
      const text = getBlockText(block);
      const boundary = findNextWordBoundary(text, pos.offset);
      const count = boundary - pos.offset;
      this.doc.deleteText(pos, count);
      this.markDirty(pos.blockId);
    } else {
      // At end of block — merge with next (same as normal delete)
      const idx = this.doc.getBlockIndex(pos.blockId);
      if (idx < this.doc.document.blocks.length - 1) {
        this.invalidateLayout();
        this.doc.mergeBlocks(pos.blockId, this.doc.document.blocks[idx + 1].id);
      }
    }
    this.requestRender();
  }

  private handleEnter(): void {
    this.saveSnapshot();
    this.deleteSelection();
    this.invalidateLayout();

    const pos = this.cursor.position;
    const newBlockId = this.doc.splitBlock(pos.blockId, pos.offset);

    if (newBlockId === pos.blockId) {
      // Block was converted in-place (e.g., empty list → paragraph)
      this.cursor.moveTo({ blockId: pos.blockId, offset: 0 });
    } else {
      this.cursor.moveTo({ blockId: newBlockId, offset: 0 });
    }
    this.selection.setRange(null);
    this.requestRender();
  }

  private handleTab(shift: boolean): void {
    const block = this.doc.getBlock(this.cursor.position.blockId);
    if (block.type !== 'list-item') return;

    this.saveSnapshot();
    const currentLevel = block.listLevel ?? 0;
    const newLevel = shift ? Math.max(0, currentLevel - 1) : Math.min(8, currentLevel + 1);
    if (newLevel === currentLevel) return;

    this.doc.setBlockType(block.id, 'list-item', {
      listKind: block.listKind,
      listLevel: newLevel,
    });
    this.invalidateLayout();
    this.requestRender();
  }

  private handleArrow(
    direction: 'left' | 'right' | 'up' | 'down',
    shiftKey: boolean,
    wordMod = false,
  ): void {
    const pos = this.cursor.position;

    const move = (p: DocPosition): DocPosition => {
      switch (direction) {
        case 'left': return wordMod ? this.moveWordLeft(p) : this.moveLeft(p);
        case 'right': return wordMod ? this.moveWordRight(p) : this.moveRight(p);
        case 'up': return this.moveVertical(p, -1);
        case 'down': return this.moveVertical(p, 1);
      }
    };

    // For left/right, affinity is known statically. For up/down,
    // moveVertical sets cursor.lineAffinity from paginatedPixelToPosition,
    // so we must not overwrite it.
    const isVertical = direction === 'up' || direction === 'down';
    const hAffinity = direction === 'right' ? 'forward' as const : 'backward' as const;

    if (shiftKey) {
      const newPos = move(pos);
      const anchor = this.selection.range?.anchor ?? pos;
      this.selection.setRange({ anchor, focus: newPos });
      this.cursor.moveTo(newPos, isVertical ? this.cursor.lineAffinity : hAffinity);
    } else if (this.selection.hasSelection() && this.selection.range) {
      // Collapse selection to the appropriate boundary
      const layout = this.getLayout();
      const normalized = this.selection.getNormalizedRange(layout);
      if (normalized) {
        const collapsePos = (direction === 'left' || direction === 'up')
          ? normalized.start
          : normalized.end;
        this.cursor.moveTo(collapsePos);
      }
      this.selection.setRange(null);
    } else {
      const newPos = move(pos);
      this.selection.setRange(null);
      this.cursor.moveTo(newPos, isVertical ? this.cursor.lineAffinity : hAffinity);
    }

    this.requestRender();
  }

  private handleHome(shiftKey: boolean): void {
    const newPos = this.getVisualLineStart(this.cursor.position);
    if (shiftKey) {
      const anchor = this.selection.range?.anchor ?? this.cursor.position;
      this.selection.setRange({ anchor, focus: newPos });
    } else {
      this.selection.setRange(null);
    }
    this.cursor.moveTo(newPos, 'forward');
    this.requestRender();
  }

  private handleEnd(shiftKey: boolean): void {
    const newPos = this.getVisualLineEnd(this.cursor.position);
    if (shiftKey) {
      const anchor = this.selection.range?.anchor ?? this.cursor.position;
      this.selection.setRange({ anchor, focus: newPos });
    } else {
      this.selection.setRange(null);
    }
    this.cursor.moveTo(newPos);
    this.requestRender();
  }

  private handleDocStart(shiftKey: boolean): void {
    const blocks = this.doc.document.blocks;
    if (blocks.length === 0) return;
    const newPos: DocPosition = { blockId: blocks[0].id, offset: 0 };
    if (shiftKey) {
      const anchor = this.selection.range?.anchor ?? this.cursor.position;
      this.selection.setRange({ anchor, focus: newPos });
    } else {
      this.selection.setRange(null);
    }
    this.cursor.moveTo(newPos);
    this.requestRender();
  }

  private handleDocEnd(shiftKey: boolean): void {
    const blocks = this.doc.document.blocks;
    if (blocks.length === 0) return;
    const lastBlock = blocks[blocks.length - 1];
    const newPos: DocPosition = { blockId: lastBlock.id, offset: getBlockTextLength(lastBlock) };
    if (shiftKey) {
      const anchor = this.selection.range?.anchor ?? this.cursor.position;
      this.selection.setRange({ anchor, focus: newPos });
    } else {
      this.selection.setRange(null);
    }
    this.cursor.moveTo(newPos);
    this.requestRender();
  }

  private handleLineBackspace(): void {
    this.saveSnapshot();
    if (this.deleteSelection()) return;
    const pos = this.cursor.position;
    const lineStart = this.getVisualLineStart(pos);
    if (lineStart.offset < pos.offset) {
      const count = pos.offset - lineStart.offset;
      this.doc.deleteText(lineStart, count);
      this.cursor.moveTo(lineStart);
      this.markDirty(pos.blockId);
    } else if (pos.offset > 0) {
      // Cursor is at visual line start but not block start — delete to block start
      this.doc.deleteText({ blockId: pos.blockId, offset: 0 }, pos.offset);
      this.cursor.moveTo({ blockId: pos.blockId, offset: 0 });
      this.markDirty(pos.blockId);
    } else {
      if (this.doc.getBlockIndex(pos.blockId) === 0) return;
      this.invalidateLayout();
      const newPos = this.doc.deleteBackward(pos);
      this.cursor.moveTo(newPos);
    }
    this.requestRender();
  }

  private selectAll(): void {
    const blocks = this.doc.document.blocks;
    if (blocks.length === 0) return;
    const firstBlock = blocks[0];
    const lastBlock = blocks[blocks.length - 1];
    this.selection.setRange({
      anchor: { blockId: firstBlock.id, offset: 0 },
      focus: {
        blockId: lastBlock.id,
        offset: getBlockTextLength(lastBlock),
      },
    });
    this.cursor.moveTo({
      blockId: lastBlock.id,
      offset: getBlockTextLength(lastBlock),
    });
    this.requestRender();
  }

  private clearFormatting(): void {
    if (!this.selection.hasSelection() || !this.selection.range) return;
    this.saveSnapshot();
    const range = this.selection.range;
    this.doc.applyInlineStyle(range, {
      bold: undefined,
      italic: undefined,
      underline: undefined,
      strikethrough: undefined,
    });
    const startIdx = this.doc.getBlockIndex(range.anchor.blockId);
    const endIdx = this.doc.getBlockIndex(range.focus.blockId);
    if (startIdx < 0 || endIdx < 0) {
      this.requestRender();
      return;
    }
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    for (let i = lo; i <= hi; i++) {
      this.markDirty(this.doc.document.blocks[i].id);
    }
    this.requestRender();
  }

  private toggleStyle(style: Partial<InlineStyle>): void {
    if (!this.selection.hasSelection() || !this.selection.range) return;
    const range = this.selection.range;
    this.doc.applyInlineStyle(range, style);
    // Mark all blocks in the selection range as dirty
    const startIdx = this.doc.getBlockIndex(range.anchor.blockId);
    const endIdx = this.doc.getBlockIndex(range.focus.blockId);
    if (startIdx < 0 || endIdx < 0) {
      this.requestRender();
      return;
    }
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    for (let i = lo; i <= hi; i++) {
      this.markDirty(this.doc.document.blocks[i].id);
    }
    this.requestRender();
  }

  // --- Helpers ---

  /**
   * Delete currently selected text. Returns true if there was a selection.
   */
  private deleteSelection(): boolean {
    if (!this.selection.hasSelection()) return false;

    const layout = this.getLayout();
    const normalized = this.selection.getNormalizedRange(layout);
    if (!normalized) return false;

    const { start, end } = normalized;
    const startBlockIdx = this.doc.getBlockIndex(start.blockId);
    const endBlockIdx = this.doc.getBlockIndex(end.blockId);

    if (startBlockIdx === endBlockIdx) {
      // Same block — mark dirty for incremental layout
      this.doc.deleteText(start, end.offset - start.offset);
      this.markDirty(start.blockId);
    } else {
      // Multi-block structural change — force full layout recompute
      this.invalidateLayout();
      // Delete from start to end of first block
      const firstBlock = this.doc.getBlock(start.blockId);
      const firstLen = getBlockTextLength(firstBlock);
      if (start.offset < firstLen) {
        this.doc.deleteText(start, firstLen - start.offset);
      }

      // Delete from beginning to end position in last block
      if (end.offset > 0) {
        this.doc.deleteText({ blockId: end.blockId, offset: 0 }, end.offset);
      }

      // Remove middle blocks
      for (let i = endBlockIdx - 1; i > startBlockIdx; i--) {
        this.doc.deleteBlockByIndex(i);
      }

      // Merge first and last blocks
      const lastBlockId = this.doc.document.blocks[startBlockIdx + 1]?.id;
      if (lastBlockId) {
        this.doc.mergeBlocks(start.blockId, lastBlockId);
      }
    }

    this.cursor.moveTo(start);
    this.selection.setRange(null);
    this.requestRender();
    return true;
  }

  private moveLeft(pos: DocPosition): DocPosition {
    if (pos.offset > 0) {
      return { blockId: pos.blockId, offset: pos.offset - 1 };
    }
    // Move to end of previous block
    const idx = this.doc.getBlockIndex(pos.blockId);
    if (idx > 0) {
      const prevBlock = this.doc.document.blocks[idx - 1];
      return { blockId: prevBlock.id, offset: getBlockTextLength(prevBlock) };
    }
    return pos;
  }

  private moveRight(pos: DocPosition): DocPosition {
    const block = this.doc.getBlock(pos.blockId);
    const len = getBlockTextLength(block);
    if (pos.offset < len) {
      return { blockId: pos.blockId, offset: pos.offset + 1 };
    }
    // Move to start of next block
    const idx = this.doc.getBlockIndex(pos.blockId);
    if (idx < this.doc.document.blocks.length - 1) {
      return { blockId: this.doc.document.blocks[idx + 1].id, offset: 0 };
    }
    return pos;
  }

  private moveWordLeft(pos: DocPosition): DocPosition {
    if (pos.offset > 0) {
      const text = getBlockText(this.doc.getBlock(pos.blockId));
      return { blockId: pos.blockId, offset: findPrevWordBoundary(text, pos.offset) };
    }
    // At start of block — move to end of previous block
    const idx = this.doc.getBlockIndex(pos.blockId);
    if (idx > 0) {
      const prevBlock = this.doc.document.blocks[idx - 1];
      return { blockId: prevBlock.id, offset: getBlockTextLength(prevBlock) };
    }
    return pos;
  }

  private moveWordRight(pos: DocPosition): DocPosition {
    const block = this.doc.getBlock(pos.blockId);
    const len = getBlockTextLength(block);
    if (pos.offset < len) {
      const text = getBlockText(block);
      return { blockId: pos.blockId, offset: findNextWordBoundary(text, pos.offset) };
    }
    // At end of block — move to start of next block
    const idx = this.doc.getBlockIndex(pos.blockId);
    if (idx < this.doc.document.blocks.length - 1) {
      return { blockId: this.doc.document.blocks[idx + 1].id, offset: 0 };
    }
    return pos;
  }

  /**
   * Find the visual line containing the given position and return
   * the character offset range [start, end] within the block.
   */
  private getVisualLineRange(pos: DocPosition): [number, number] {
    const layout = this.getLayout();
    const lb = layout.blocks.find((b) => b.block.id === pos.blockId);
    if (!lb) return [0, 0];

    const info = findVisualLine(lb, pos);
    if (info) return [info.lineStart, info.lineEnd];

    const total = getBlockTextLength(lb.block);
    return [0, total];
  }

  private getVisualLineStart(pos: DocPosition): DocPosition {
    const [start] = this.getVisualLineRange(pos);
    return { blockId: pos.blockId, offset: start };
  }

  private getVisualLineEnd(pos: DocPosition): DocPosition {
    const [lineStart, lineEnd] = this.getVisualLineRange(pos);
    const block = this.doc.getBlock(pos.blockId);
    const totalLen = getBlockTextLength(block);

    // For wrapped lines (not the last line), exclude trailing spaces
    if (lineEnd < totalLen) {
      const text = getBlockText(block);
      let end = lineEnd;
      while (end > lineStart && text[end - 1] === ' ') end--;
      return { blockId: pos.blockId, offset: end };
    }

    return { blockId: pos.blockId, offset: lineEnd };
  }

  /**
   * Determine cursor affinity for a position after text insertion.
   * Returns 'forward' when the offset coincides with the start of a
   * non-first visual line (i.e., a line-wrap boundary).
   */
  private getWrapAffinity(pos: DocPosition): 'forward' | 'backward' {
    const layout = this.getLayout();
    const lb = layout.blocks.find((b) => b.block.id === pos.blockId);
    if (!lb || lb.lines.length <= 1) return 'backward';

    let charsBefore = 0;
    for (let i = 0; i < lb.lines.length; i++) {
      if (i > 0 && charsBefore === pos.offset) return 'forward';
      let lineChars = 0;
      for (const run of lb.lines[i].runs) {
        lineChars += run.charEnd - run.charStart;
      }
      charsBefore += lineChars;
    }
    return 'backward';
  }

  private moveVertical(pos: DocPosition, direction: -1 | 1): DocPosition {
    const pixel = this.getPixelForPosition(pos, this.cursor.lineAffinity);
    if (!pixel) return pos;

    const paginatedLayout = this.getPaginatedLayout();
    const layout = this.getLayout();
    const canvasWidth = this.getCanvasWidth();

    const newY = pixel.y + pixel.height * direction + pixel.height / 2;
    const result = paginatedPixelToPosition(
      paginatedLayout, layout, pixel.x, newY, canvasWidth,
    );

    // If cursor didn't move, we may be at a page boundary.
    // Jump to the adjacent page's first/last line.
    if (result && result.blockId === pos.blockId && result.offset === pos.offset) {
      const pageInfo = findPageForPosition(paginatedLayout, pos.blockId, pos.offset, layout, this.cursor.lineAffinity);
      if (pageInfo) {
        const nextPageIndex = pageInfo.pageIndex + direction;
        const nextPage = paginatedLayout.pages[nextPageIndex];
        if (nextPage && nextPage.lines.length > 0) {
          // Down → first line of next page, Up → last line of previous page
          const targetLine = direction === 1
            ? nextPage.lines[0]
            : nextPage.lines[nextPage.lines.length - 1];
          const pageTop = getPageYOffset(paginatedLayout, nextPageIndex);
          const targetY = pageTop + targetLine.y + targetLine.line.height / 2;
          const crossPageResult = paginatedPixelToPosition(
            paginatedLayout, layout, pixel.x, targetY, canvasWidth,
          );
          if (crossPageResult) {
            this.cursor.lineAffinity = crossPageResult.lineAffinity;
            return crossPageResult;
          }
          return pos;
        }
      }
    }

    // If the result is on the same visual line (first line up or last line down),
    // jump to line start (up) or line end (down).
    if (result) {
      const lb = layout.blocks.find((b) => b.block.id === pos.blockId);
      if (lb) {
        const info = findVisualLine(lb, pos);
        if (info) {
          const sameBlock = result.blockId === pos.blockId;
          const isFirstLine = info.lineIndex === 0;
          const isLastLine = info.lineIndex === info.totalLines - 1;
          if (direction === -1 && sameBlock && isFirstLine && layout.blocks[0]?.block.id === pos.blockId) {
            this.cursor.lineAffinity = 'forward';
            return { blockId: pos.blockId, offset: info.lineStart };
          }
          if (direction === 1 && sameBlock && isLastLine && layout.blocks[layout.blocks.length - 1]?.block.id === pos.blockId) {
            this.cursor.lineAffinity = 'backward';
            return { blockId: pos.blockId, offset: info.lineEnd };
          }
        }
      }
      this.cursor.lineAffinity = result.lineAffinity;
      return result;
    }
    return pos;
  }

  private getPositionFromMouse(e: MouseEvent): (DocPosition & { lineAffinity: 'forward' | 'backward' }) | undefined {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top - this.getCanvasOffsetTop();
    const scrollY = this.container.scrollTop;
    return paginatedPixelToPosition(
      this.getPaginatedLayout(), this.getLayout(), x, y + scrollY, this.getCanvasWidth(),
    );
  }

  private getPixelForPosition(pos: DocPosition, lineAffinity: 'forward' | 'backward' = 'backward') {
    const paginatedLayout = this.getPaginatedLayout();
    const layout = this.getLayout();
    const ctx = this.getCtx();
    const canvasWidth = this.getCanvasWidth();
    const found = findPageForPosition(paginatedLayout, pos.blockId, pos.offset, layout, lineAffinity);
    if (!found) return undefined;

    const { pageIndex, pageLine } = found;
    const pageX = getPageXOffset(paginatedLayout, canvasWidth);
    const pageY = getPageYOffset(paginatedLayout, pageIndex);
    const lb = layout.blocks[pageLine.blockIndex];

    let charsBeforeLine = 0;
    for (let li = 0; li < pageLine.lineIndex; li++) {
      for (const r of lb.lines[li].runs) {
        charsBeforeLine += r.charEnd - r.charStart;
      }
    }
    const lineOffset = pos.offset - charsBeforeLine;

    let charCount = 0;
    for (const run of pageLine.line.runs) {
      const runLength = run.charEnd - run.charStart;
      if (lineOffset >= charCount && lineOffset <= charCount + runLength) {
        const localOff = lineOffset - charCount;
        ctx.font = buildFont(run.inline.style.fontSize, run.inline.style.fontFamily, run.inline.style.bold, run.inline.style.italic);
        const x = pageX + pageLine.x + run.x + ctx.measureText(run.text.slice(0, localOff)).width;
        return { x, y: pageY + pageLine.y, height: pageLine.line.height };
      }
      charCount += runLength;
    }

    const lastRun = pageLine.line.runs[pageLine.line.runs.length - 1];
    if (lastRun) {
      return { x: pageX + pageLine.x + lastRun.x + lastRun.width, y: pageY + pageLine.y, height: pageLine.line.height };
    }
    return { x: pageX + pageLine.x, y: pageY + pageLine.y, height: 24 };
  }

  // --- Software Hangul assembly helpers ---

  private applyHangulResult(result: HangulResult): void {
    if (result.commit) {
      if (this.hangulComposingLength > 0) {
        this.doc.deleteText(this.hangulStartPos, this.hangulComposingLength);
        this.doc.insertText(this.hangulStartPos, result.commit);
        this.hangulStartPos = {
          blockId: this.hangulStartPos.blockId,
          offset: this.hangulStartPos.offset + result.commit.length,
        };
      } else {
        this.deleteSelection();
        this.doc.insertText(this.cursor.position, result.commit);
        this.hangulStartPos = {
          blockId: this.cursor.position.blockId,
          offset: this.cursor.position.offset + result.commit.length,
        };
      }
      this.hangulComposingLength = 0;
    }

    if (result.composing) {
      if (this.hangulComposingLength === 0 && !result.commit) {
        this.saveSnapshot();
        this.deleteSelection();
        this.hangulStartPos = { ...this.cursor.position };
      }
      if (this.hangulComposingLength > 0) {
        this.doc.deleteText(this.hangulStartPos, this.hangulComposingLength);
      }
      this.doc.insertText(this.hangulStartPos, result.composing);
      this.hangulComposingLength = result.composing.length;
    } else {
      this.hangulComposingLength = 0;
    }

    const hangulPos = {
      blockId: this.hangulStartPos.blockId,
      offset: this.hangulStartPos.offset + this.hangulComposingLength,
    };
    this.markDirty(this.hangulStartPos.blockId);
    this.cursor.moveTo(hangulPos, this.getWrapAffinity(hangulPos));
    this.requestRender();
  }

  private flushHangul(): void {
    if (!this.hangulAssembler.isComposing) return;
    const result = this.hangulAssembler.flush();
    if (result) {
      this.applyHangulResult(result);
    }
  }

  /**
   * Move the hidden textarea to the cursor's screen position so the
   * browser doesn't scroll the container to bring the textarea into view.
   * The textarea uses position:fixed, so coordinates are viewport-relative.
   */
  updateTextareaPosition(screenX: number, screenY: number): void {
    this.textarea.style.top = `${screenY}px`;
    this.textarea.style.left = `${screenX}px`;
  }

  dispose(): void {
    this.textarea.removeEventListener('input', this.handleInput);
    this.textarea.removeEventListener('keydown', this.handleKeyDown);
    this.textarea.removeEventListener('compositionstart', this.handleCompositionStart);
    this.textarea.removeEventListener('compositionend', this.handleCompositionEnd);
    this.textarea.removeEventListener('copy', this.handleCopy);
    this.textarea.removeEventListener('cut', this.handleCut);
    this.textarea.removeEventListener('paste', this.handlePaste);
    if (this.handleFocus) this.textarea.removeEventListener('focus', this.handleFocus);
    if (this.handleBlur) this.textarea.removeEventListener('blur', this.handleBlur);
    this.container.removeEventListener('mousedown', this.handleMouseDown);
    this.container.removeEventListener('mousemove', this.handleMouseMove);
    this.container.removeEventListener('mouseup', this.handleMouseUp);
    this.stopDragScroll();
    this.textarea.remove();
  }
}
