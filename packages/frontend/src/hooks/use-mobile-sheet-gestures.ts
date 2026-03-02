import type { Spreadsheet } from "@wafflebase/sheet";
import { useEffect, type RefObject } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const PanThresholdPx = 8;
const DoubleTapDelayMs = 280;
const DoubleTapDistancePx = 24;
const LongPressDelayMs = 500;
const LongPressTolerancePx = 10;

interface UseMobileSheetGesturesOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  sheetRef: RefObject<Spreadsheet | undefined>;
  enabled?: boolean;
  onLongPress?: (clientX: number, clientY: number) => void;
}

/**
 * Adds touch gestures for mobile spreadsheets:
 * - one-finger drag to pan the grid
 * - double-tap to enter cell edit mode
 * - long-press to trigger a context action (e.g. clipboard menu)
 */
export function useMobileSheetGestures({
  containerRef,
  sheetRef,
  enabled = true,
  onLongPress,
}: UseMobileSheetGesturesOptions): void {
  const isMobile = useIsMobile();

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !isMobile || !container) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let panning = false;
    let hadMultiTouch = false;

    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        hadMultiTouch = e.touches.length > 1;
        panning = false;
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        return;
      }

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      lastX = touch.clientX;
      lastY = touch.clientY;

      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        onLongPress?.(startX, startY);
      }, LongPressDelayMs);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        hadMultiTouch = hadMultiTouch || e.touches.length > 1;
        return;
      }

      const touch = e.touches[0];
      const deltaX = touch.clientX - lastX;
      const deltaY = touch.clientY - lastY;
      const movedDistance = Math.hypot(
        touch.clientX - startX,
        touch.clientY - startY,
      );

      if (longPressTimer && movedDistance >= LongPressTolerancePx) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      if (!panning && movedDistance >= PanThresholdPx) {
        panning = true;
      }

      if (panning) {
        e.preventDefault();
        sheetRef.current?.panBy(-deltaX, -deltaY);
      }

      lastX = touch.clientX;
      lastY = touch.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      if (e.touches.length > 0) {
        return;
      }

      if (hadMultiTouch) {
        hadMultiTouch = false;
        panning = false;
        return;
      }

      if (panning) {
        panning = false;
        return;
      }

      const now = Date.now();
      const tapDistance = Math.hypot(lastX - lastTapX, lastY - lastTapY);
      if (
        lastTapAt !== 0 &&
        now - lastTapAt <= DoubleTapDelayMs &&
        tapDistance <= DoubleTapDistancePx
      ) {
        // Prevent the browser from synthesizing mousedown/dblclick after
        // this touch sequence — those synthesized events would trigger the
        // Worksheet's inline cell editor and a selection change that
        // immediately dismisses the MobileEditPanel.
        e.preventDefault();
        sheetRef.current?.handleMobileDoubleTap(lastX, lastY);
        lastTapAt = 0;
        return;
      }

      lastTapAt = now;
      lastTapX = lastX;
      lastTapY = lastY;
    };

    const onTouchCancel = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      panning = false;
      hadMultiTouch = false;
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [containerRef, enabled, isMobile, onLongPress, sheetRef]);
}
