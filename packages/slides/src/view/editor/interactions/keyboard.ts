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
  requestRender(): void;
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
  ];
}

function currentSlide(ctx: KeyboardContext) {
  const id = ctx.currentSlideId();
  if (!id) return undefined;
  return ctx.store.read().slides.find((s) => s.id === id);
}

async function writeClipboard(elements: readonly Element[]): Promise<void> {
  const json = serializeElements(elements);
  const item = new ClipboardItem({
    [MIME_TYPE]: new Blob([json], { type: MIME_TYPE }),
  });
  await navigator.clipboard.write([item]);
}

async function readClipboard(): Promise<ElementInit[] | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes(MIME_TYPE)) {
        const blob = await item.getType(MIME_TYPE);
        const json = await blob.text();
        return deserializeElements(json);
      }
    }
    return null;
  } catch {
    return null; // permission denied or no slides payload
  }
}

function keyEquals(eventKey: string, target: string): boolean {
  return eventKey.toLowerCase() === target.toLowerCase();
}
