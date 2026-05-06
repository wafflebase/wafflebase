import type { SlidesStore } from '../../../store/store';
import type { Selection } from '../selection';
import { isModPressed, type KeyRule } from '../keymap';

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
 * T2 will append more rules (Cmd+C/X/V, Cmd+D, z-order shortcuts) by
 * extending this same array.
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
  ];
}

function keyEquals(eventKey: string, target: string): boolean {
  return eventKey.toLowerCase() === target.toLowerCase();
}
