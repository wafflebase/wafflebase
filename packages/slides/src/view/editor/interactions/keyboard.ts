import type { Element, ElementInit } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';
import type { Selection } from '../selection';
import { isModPressed, type KeyRule } from '../keymap';
import {
  MIME_TYPE,
  serializeElements,
  deserializeElements,
} from './clipboard';

export interface KeyboardContext {
  store: SlidesStore;
  selection: Selection;
  currentSlideId(): string | undefined;
  /** Switch to the given slide. Used by Page Up / Page Down and Cmd+M. */
  setCurrentSlide(id: string): void;
  /** Enter text-edit mode on the given element. Used by F2 / Enter. */
  enterEditMode(slideId: string, elementId: string): void;
  requestRender(): void;
  /** Optional callbacks wired by the host shell. No-op if absent. */
  onStartPresentation?: (from: 'current' | 'first') => void;
  onShowShortcutsHelp?: () => void;
}

const NUDGE = 1;
const NUDGE_SHIFT = 10;

/**
 * Build the keyboard rules for the editor. T1 covers nudge + undo/redo;
 * T2 appends the clipboard / duplicate / z-order rules to the same array.
 */
export function buildKeyRules(ctx: KeyboardContext): KeyRule[] {
  return [
    // Undo / Redo (mod-Z and mod-shift-Z) — listed before the arrow
    // rules so a stray Z key doesn't fall through.
    {
      match: (e) =>
        keyEquals(e.key, 'z') && isModPressed(e) && !e.shiftKey,
      run: (e) => { e.preventDefault(); ctx.store.undo(); ctx.requestRender(); },
    },
    {
      match: (e) =>
        keyEquals(e.key, 'z') && isModPressed(e) && e.shiftKey,
      run: (e) => { e.preventDefault(); ctx.store.redo(); ctx.requestRender(); },
    },

    // Delete / Backspace — remove selected elements. Skipped while the
    // user is typing in a textarea/input/contenteditable so Backspace
    // inside the inline text-box editor still deletes characters.
    {
      match: (e) =>
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !isModPressed(e) &&
        !isEditableTarget(e.target),
      run: (e) => {
        const ids = ctx.selection.get();
        if (ids.length === 0) return;
        const slide = currentSlide(ctx);
        if (!slide) return;
        e.preventDefault();
        ctx.store.batch(() =>
          ctx.store.removeElements(slide.id, [...ids]),
        );
        ctx.selection.clear();
        ctx.requestRender();
      },
    },

    // Arrow nudge — only when something is selected and no modifier.
    ...(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const).map(
      (key): KeyRule => ({
        match: (e) =>
          e.key === key && !isModPressed(e),
        run: (e) => {
          if (ctx.selection.get().length === 0) return;
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_SHIFT : NUDGE;
          const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
          const dy = key === 'ArrowUp'   ? -step : key === 'ArrowDown'  ? step : 0;
          const slideId = ctx.currentSlideId();
          if (!slideId) return;
          ctx.store.batch(() => {
            for (const id of ctx.selection.get()) {
              const slide = ctx.store.read().slides.find((s) => s.id === slideId);
              if (!slide) continue;
              const el = slide.elements.find((x) => x.id === id);
              if (!el) continue;
              ctx.store.updateElementFrame(slideId, id, {
                x: el.frame.x + dx,
                y: el.frame.y + dy,
              });
            }
          });
          ctx.requestRender();
        },
      }),
    ),

    // --- T2: clipboard / duplicate / z-order ---

    // Cmd+C — copy selected elements via custom MIME.
    {
      match: (e) => keyEquals(e.key, 'c') && isModPressed(e) && !e.shiftKey,
      run: async (e) => {
        const ids = ctx.selection.get();
        if (ids.length === 0) return;
        const slide = currentSlide(ctx);
        if (!slide) return;
        const selected = slide.elements.filter((el) => ids.includes(el.id));
        if (selected.length === 0) return;
        e.preventDefault();
        await writeClipboard(selected);
      },
    },

    // Cmd+X — cut: copy then remove.
    {
      match: (e) => keyEquals(e.key, 'x') && isModPressed(e) && !e.shiftKey,
      run: async (e) => {
        const ids = ctx.selection.get();
        if (ids.length === 0) return;
        const slide = currentSlide(ctx);
        if (!slide) return;
        const selected = slide.elements.filter((el) => ids.includes(el.id));
        if (selected.length === 0) return;
        e.preventDefault();
        await writeClipboard(selected);
        ctx.store.batch(() => ctx.store.removeElements(slide.id, [...ids]));
        ctx.selection.clear();
        ctx.requestRender();
      },
    },

    // Cmd+V — paste from clipboard. Offsets each pasted element by
    // (10, 10) so the copy doesn't overlap the source exactly.
    {
      match: (e) => keyEquals(e.key, 'v') && isModPressed(e),
      run: async (e) => {
        const slide = currentSlide(ctx);
        if (!slide) return;
        const inits = await readClipboard();
        if (inits === null) return;
        e.preventDefault();
        const newIds: string[] = [];
        ctx.store.batch(() => {
          for (const init of inits) {
            const offsetInit = {
              ...init,
              frame: { ...init.frame, x: init.frame.x + 10, y: init.frame.y + 10 },
            } as ElementInit;
            newIds.push(ctx.store.addElement(slide.id, offsetInit));
          }
        });
        ctx.selection.set(newIds);
        ctx.requestRender();
      },
    },

    // Cmd+D — duplicate selected elements (or the current slide if no
    // element is selected).
    {
      match: (e) => keyEquals(e.key, 'd') && isModPressed(e) && !e.shiftKey,
      run: (e) => {
        e.preventDefault();
        const slide = currentSlide(ctx);
        if (!slide) return;
        const ids = ctx.selection.get();
        if (ids.length === 0) {
          ctx.store.batch(() => ctx.store.duplicateSlide(slide.id));
        } else {
          const selected = slide.elements.filter((el) => ids.includes(el.id));
          const newIds: string[] = [];
          ctx.store.batch(() => {
            for (const el of selected) {
              const { id: _drop, ...rest } = el;
              const offsetInit = {
                ...rest,
                frame: { ...rest.frame, x: rest.frame.x + 10, y: rest.frame.y + 10 },
              } as ElementInit;
              newIds.push(ctx.store.addElement(slide.id, offsetInit));
            }
          });
          ctx.selection.set(newIds);
        }
        ctx.requestRender();
      },
    },

    // z-order: Cmd+↑ bring forward, Cmd+↓ send backward,
    //          Cmd+Shift+↑ bring to front, Cmd+Shift+↓ send to back.
    {
      match: (e) =>
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') && isModPressed(e),
      run: (e) => {
        const ids = ctx.selection.get();
        if (ids.length === 0) return;
        const slide = currentSlide(ctx);
        if (!slide) return;
        e.preventDefault();
        const direction: 'forward' | 'backward' =
          e.key === 'ArrowUp' ? 'forward' : 'backward';
        const toEnd = e.shiftKey;
        const slideId = slide.id;
        ctx.store.batch(() => {
          for (const id of ids) {
            const live = ctx.store.read().slides.find((s) => s.id === slideId);
            if (!live) continue;
            const idx = live.elements.findIndex((el) => el.id === id);
            if (idx === -1) continue;
            const length = live.elements.length;
            let target: number;
            if (direction === 'forward') {
              target = toEnd ? length - 1 : Math.min(idx + 1, length - 1);
            } else {
              target = toEnd ? 0 : Math.max(idx - 1, 0);
            }
            ctx.store.reorderElement(slideId, id, target);
          }
        });
        ctx.requestRender();
      },
    },

    // --- Parity pass: selection / slide / present / help ---

    // Cmd+/ — show shortcuts help. Bypasses the editable-target gate so
    // the help modal opens even while typing in a text-box. Matches
    // only when a host handler is wired so an unhandled Cmd+/ falls
    // through to the browser default.
    {
      match: (e) =>
        keyEquals(e.key, '/') &&
        isModPressed(e) &&
        ctx.onShowShortcutsHelp !== undefined,
      run: (e) => {
        if (!ctx.onShowShortcutsHelp) return;
        e.preventDefault();
        ctx.onShowShortcutsHelp();
      },
    },

    // Cmd+Shift+Enter — present from first slide. Must precede the
    // Cmd+Enter rule so the shift variant doesn't get swallowed.
    // Both rules are gated by the editable-target check: docs
    // text-editor binds Cmd+Enter to a page-break op (a docs-only
    // concept) which would corrupt slide text-element data if it ran
    // inside a slides text-box. Users can press Esc to exit text edit
    // before starting present mode. See design doc "Esc semantics"
    // and the "Cmd+Enter implementation deviation" note.
    {
      match: (e) =>
        e.key === 'Enter' &&
        isModPressed(e) &&
        e.shiftKey &&
        !isEditableTarget(e.target) &&
        ctx.onStartPresentation !== undefined,
      run: (e) => {
        if (!ctx.onStartPresentation) return;
        e.preventDefault();
        ctx.onStartPresentation('first');
      },
    },
    {
      match: (e) =>
        e.key === 'Enter' &&
        isModPressed(e) &&
        !e.shiftKey &&
        !isEditableTarget(e.target) &&
        ctx.onStartPresentation !== undefined,
      run: (e) => {
        if (!ctx.onStartPresentation) return;
        e.preventDefault();
        ctx.onStartPresentation('current');
      },
    },

    // Cmd+A — select all elements on the current slide.
    {
      match: (e) =>
        keyEquals(e.key, 'a') &&
        isModPressed(e) &&
        !e.shiftKey &&
        !isEditableTarget(e.target),
      run: (e) => {
        const slide = currentSlide(ctx);
        if (!slide || slide.elements.length === 0) return;
        e.preventDefault();
        ctx.selection.set(slide.elements.map((el) => el.id));
        ctx.requestRender();
      },
    },

    // Cmd+M — add a new slide after the current, using the current
    // slide's layout, and switch to it.
    {
      match: (e) =>
        keyEquals(e.key, 'm') &&
        isModPressed(e) &&
        !e.shiftKey &&
        !isEditableTarget(e.target),
      run: (e) => {
        const slide = currentSlide(ctx);
        if (!slide) return;
        e.preventDefault();
        const slides = ctx.store.read().slides;
        const currentIdx = slides.findIndex((s) => s.id === slide.id);
        let newId = '';
        ctx.store.batch(() => {
          newId = ctx.store.addSlide(slide.layoutId, currentIdx + 1);
        });
        if (newId) ctx.setCurrentSlide(newId);
        ctx.requestRender();
      },
    },

    // Cmd+Shift+D — duplicate the current slide explicitly. Distinct
    // from Cmd+D, which duplicates the selected element(s) and only
    // falls back to slide-duplicate when nothing is selected.
    {
      match: (e) =>
        keyEquals(e.key, 'd') &&
        isModPressed(e) &&
        e.shiftKey &&
        !isEditableTarget(e.target),
      run: (e) => {
        const slide = currentSlide(ctx);
        if (!slide) return;
        e.preventDefault();
        ctx.store.batch(() => ctx.store.duplicateSlide(slide.id));
        ctx.requestRender();
      },
    },

    // Page Up / Page Down — switch to previous / next slide. Gated by
    // editable target so PgUp/PgDn inside a focused textarea retains
    // its default behaviour (caret movement).
    {
      match: (e) =>
        (e.key === 'PageUp' || e.key === 'PageDown') &&
        !isModPressed(e) &&
        !isEditableTarget(e.target),
      run: (e) => {
        const slides = ctx.store.read().slides;
        if (slides.length === 0) return;
        const currentId = ctx.currentSlideId();
        const currentIdx = slides.findIndex((s) => s.id === currentId);
        if (currentIdx === -1) return;
        const targetIdx =
          e.key === 'PageUp'
            ? Math.max(0, currentIdx - 1)
            : Math.min(slides.length - 1, currentIdx + 1);
        if (targetIdx === currentIdx) return;
        e.preventDefault();
        ctx.setCurrentSlide(slides[targetIdx].id);
      },
    },

    // Tab / Shift+Tab — cycle next / previous element on the current
    // slide. Empty selection: Tab picks the first element, Shift+Tab
    // picks the last (matches Google Slides).
    {
      match: (e) =>
        e.key === 'Tab' &&
        !isModPressed(e) &&
        !e.altKey &&
        !isEditableTarget(e.target),
      run: (e) => {
        const slide = currentSlide(ctx);
        if (!slide || slide.elements.length === 0) return;
        e.preventDefault();
        const direction: 'next' | 'prev' = e.shiftKey ? 'prev' : 'next';
        const selected = ctx.selection.get();
        const len = slide.elements.length;
        let nextIdx: number;
        if (selected.length === 0) {
          nextIdx = direction === 'next' ? 0 : len - 1;
        } else {
          // Anchor on the last element in selection (in array order)
          // so repeated Tab walks forward through the slide.
          let anchor = -1;
          for (let i = len - 1; i >= 0; i--) {
            if (selected.includes(slide.elements[i].id)) {
              anchor = i;
              break;
            }
          }
          if (anchor === -1) {
            nextIdx = direction === 'next' ? 0 : len - 1;
          } else {
            const step = direction === 'next' ? 1 : -1;
            nextIdx = (anchor + step + len) % len;
          }
        }
        ctx.selection.set([slide.elements[nextIdx].id]);
        ctx.requestRender();
      },
    },

    // F2 / Enter — enter text-edit mode on the selected text element.
    // Only fires when:
    //   - exactly one element is selected,
    //   - that element is type 'text',
    //   - the focused target isn't an editable input (so Enter still
    //     submits dialogs and the text-box editor's own Enter keeps
    //     inserting newlines).
    {
      match: (e) =>
        (e.key === 'F2' || e.key === 'Enter') &&
        !isModPressed(e) &&
        !e.shiftKey &&
        !e.altKey &&
        !isEditableTarget(e.target),
      run: (e) => {
        const slide = currentSlide(ctx);
        if (!slide) return;
        const selected = ctx.selection.get();
        if (selected.length !== 1) return;
        const element = slide.elements.find((el) => el.id === selected[0]);
        if (!element || element.type !== 'text') return;
        e.preventDefault();
        ctx.enterEditMode(slide.id, element.id);
      },
    },

    // Esc — clear selection when something is selected and no
    // editable target is focused. Text-box Esc is handled by the
    // text-box editor's own capture-phase listener (which stops
    // propagation before reaching this rule). Popover/context-menu
    // Esc is also captured at their layer.
    {
      match: (e) =>
        e.key === 'Escape' &&
        !isModPressed(e) &&
        !isEditableTarget(e.target),
      run: (e) => {
        if (ctx.selection.get().length === 0) return;
        e.preventDefault();
        ctx.selection.clear();
        ctx.requestRender();
      },
    },
  ];
}

function currentSlide(ctx: KeyboardContext) {
  const id = ctx.currentSlideId();
  if (!id) return undefined;
  return ctx.store.read().slides.find((s) => s.id === id);
}

/**
 * Write `elements` to the system clipboard. Includes BOTH the custom
 * MIME type (used when pasting back into slides) and a `text/plain`
 * fallback containing the same JSON, which is what other editors will
 * see if they paste from us. The text/plain copy also lets `read()`
 * recover the payload on browsers that don't surface custom types
 * (current Safari).
 */
async function writeClipboard(elements: readonly Element[]): Promise<void> {
  const json = serializeElements(elements);
  try {
    const item = new ClipboardItem({
      [MIME_TYPE]: new Blob([json], { type: MIME_TYPE }),
      'text/plain': new Blob([json], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
  } catch (err) {
    // Last-resort fallback: text/plain only. Triggered when the browser
    // refuses the ClipboardItem (older Chrome without web-prefix support,
    // OS-level clipboard permission denied, etc.).
    console.warn('[slides] clipboard write fell back to text/plain:', err);
    try {
      await navigator.clipboard.writeText(json);
    } catch (innerErr) {
      console.warn('[slides] clipboard write failed entirely:', innerErr);
    }
  }
}

/**
 * Read elements from the system clipboard. Tries the custom MIME type
 * first, then falls back to text/plain (which we always co-write, and
 * which a sibling slides instance using writeText would also produce).
 * Returns `null` when the clipboard is empty or holds non-slides text.
 */
async function readClipboard(): Promise<ElementInit[] | null> {
  // Path 1: rich clipboard read (custom MIME).
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes(MIME_TYPE)) {
        const blob = await item.getType(MIME_TYPE);
        const json = await blob.text();
        return deserializeElements(json);
      }
    }
    // Custom type not present; fall through to text/plain.
    for (const item of items) {
      if (item.types.includes('text/plain')) {
        const blob = await item.getType('text/plain');
        const json = await blob.text();
        return tryDeserialize(json);
      }
    }
    return null;
  } catch (err) {
    console.warn('[slides] clipboard read fell back to readText:', err);
    // Path 2: plain-text read (works without explicit clipboard-read
    // permission on more browsers).
    try {
      const json = await navigator.clipboard.readText();
      return tryDeserialize(json);
    } catch (innerErr) {
      console.warn('[slides] clipboard read failed entirely:', innerErr);
      return null;
    }
  }
}

function tryDeserialize(json: string): ElementInit[] | null {
  try {
    return deserializeElements(json);
  } catch {
    return null; // text/plain didn't carry a slides payload
  }
}

function keyEquals(eventKey: string, target: string): boolean {
  return eventKey.toLowerCase() === target.toLowerCase();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  // Also gate against interactive widgets (dialogs, dropdowns, focused
  // buttons). Without this, Tab inside the shortcuts-help dialog would
  // be hijacked by the slides Tab-cycle rule, and Enter on a focused
  // toolbar button would enter text-edit mode instead of activating
  // the button. We treat any of these as "not the slide canvas" and
  // let the default browser/widget handling run.
  if (tag === 'BUTTON') return true;
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"], [role="tree"], [role="grid"]')) {
    return true;
  }
  if (target.matches('[role="button"], [role="menuitem"], [role="option"], [role="tab"]')) {
    return true;
  }
  return false;
}
