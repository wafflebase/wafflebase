import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type TouchEvent,
} from "react";

/** How long a finger must rest before it counts as a press-and-hold. */
export const LONG_PRESS_MS = 500;
/** Travel past this is a scroll, not a hold. */
const MOVE_SLOP_PX = 10;

/**
 * Press-and-hold on a touch screen, as handlers to spread on the element.
 *
 * iOS Safari fires no `contextmenu` for a held non-link, so the hold is
 * timed here; Android does fire one, which is handled too (and opening
 * twice is harmless). Once a hold fires, the click the lifted finger would
 * produce is swallowed, so holding a link or a "3 replies" button opens
 * the menu without also following it.
 */
export function useLongPress(onLongPress: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  if (!enabled) return {};
  // React bubbles events out of portals along the component tree, so a tap
  // inside the sheet this opens would otherwise reach these handlers too.
  const own = (e: { currentTarget: EventTarget; target: EventTarget }) =>
    (e.currentTarget as Node).contains(e.target as Node);
  return {
    onTouchStart: (e: TouchEvent) => {
      cancel();
      if (!own(e)) return;
      fired.current = false;
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t) return;
      start.current = { x: t.clientX, y: t.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onTouchMove: (e: TouchEvent) => {
      const s = start.current;
      const t = e.touches[0];
      if (!s || !t) return;
      if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > MOVE_SLOP_PX) cancel();
    },
    onTouchEnd: (e: TouchEvent) => {
      cancel();
      // React attaches touchend non-passively, so this suppresses the
      // compatibility click.
      if (fired.current && own(e)) e.preventDefault();
    },
    onTouchCancel: cancel,
    onContextMenu: (e: MouseEvent) => {
      if (!own(e)) return;
      e.preventDefault();
      onLongPress();
    },
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current || !own(e)) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
