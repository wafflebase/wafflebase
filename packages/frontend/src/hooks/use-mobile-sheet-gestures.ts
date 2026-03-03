import type { Spreadsheet } from "@wafflebase/sheet";
import { useEffect, type RefObject } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const PanThresholdPx = 8;
const DoubleTapDelayMs = 280;
const DoubleTapDistancePx = 24;
const LongPressDelayMs = 500;
const LongPressTolerancePx = 10;
const InertiaFriction = 0.95;
const InertiaMinVelocity = 0.5;
const InertiaMaxVelocity = 60;
const VelocitySampleCount = 4;
const MinZoom = 0.5;
const MaxZoom = 2.0;

interface UseMobileSheetGesturesOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  sheetRef: RefObject<Spreadsheet | undefined>;
  enabled?: boolean;
}

/**
 * Adds touch gestures for mobile spreadsheets:
 * - one-finger drag to pan the grid
 * - two-finger pinch to zoom in/out
 * - double-tap to enter cell edit mode
 * - long-press to trigger a context action (e.g. clipboard menu)
 */
export function useMobileSheetGestures({
  containerRef,
  sheetRef,
  enabled = true,
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
    let longPressFired = false;

    const velocitySamples: Array<{ vx: number; vy: number; t: number }> = [];
    let inertiaFrame: number | null = null;

    // Pinch-to-zoom state
    let pinching = false;
    let pinchStartDist = 0;
    let pinchStartZoom = 1;

    const cancelInertia = () => {
      if (inertiaFrame !== null) {
        cancelAnimationFrame(inertiaFrame);
        inertiaFrame = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      cancelInertia();
      velocitySamples.length = 0;

      if (e.touches.length === 2) {
        hadMultiTouch = true;
        panning = false;
        pinching = true;
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.hypot(dx, dy);
        pinchStartZoom = sheetRef.current?.getZoom() ?? 1;
        return;
      }

      if (e.touches.length !== 1) {
        hadMultiTouch = e.touches.length > 1;
        panning = false;
        pinching = false;
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
      longPressFired = false;

      // Detect tap on row/column header and select immediately
      const headerHit = sheetRef.current?.headerHitTest(startX, startY);
      if (headerHit) {
        if (headerHit.axis === 'row') {
          sheetRef.current?.selectRow(headerHit.index);
        } else {
          sheetRef.current?.selectColumn(headerHit.index);
        }
      }

      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        container.dispatchEvent(
          new MouseEvent("contextmenu", {
            clientX: startX,
            clientY: startY,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, LongPressDelayMs);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinching) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (pinchStartDist > 0) {
          const scale = dist / pinchStartDist;
          const newZoom = Math.min(MaxZoom, Math.max(MinZoom, pinchStartZoom * scale));
          sheetRef.current?.setZoom(newZoom);
        }
        return;
      }

      if (e.touches.length !== 1) {
        hadMultiTouch = hadMultiTouch || e.touches.length > 1;
        return;
      }

      const touch = e.touches[0];
      const deltaX = touch.clientX - lastX;
      const deltaY = touch.clientY - lastY;

      const now = Date.now();
      velocitySamples.push({ vx: deltaX, vy: deltaY, t: now });
      if (velocitySamples.length > VelocitySampleCount) {
        velocitySamples.shift();
      }

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
        const zoom = sheetRef.current?.getZoom() ?? 1;
        sheetRef.current?.panBy(-deltaX / zoom, -deltaY / zoom);
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

      // Prevent synthesized mousedown after long-press so it doesn't
      // change the selection and dismiss the context menu.
      if (longPressFired) {
        longPressFired = false;
        e.preventDefault();
        return;
      }

      if (hadMultiTouch) {
        hadMultiTouch = false;
        panning = false;
        pinching = false;
        return;
      }

      // Prevent synthesized mousedown when a header was tapped — the
      // gesture hook already called selectRow/selectColumn directly.
      const headerHit = sheetRef.current?.headerHitTest(startX, startY);
      if (headerHit && !panning) {
        e.preventDefault();
        lastTapAt = 0;
        return;
      }

      if (panning) {
        panning = false;

        // Compute average velocity from recent samples (skip first
        // sample's delta — it predates the first timestamp).
        if (velocitySamples.length >= 2) {
          const first = velocitySamples[0];
          const last = velocitySamples[velocitySamples.length - 1];
          const dt = last.t - first.t;
          if (dt > 0) {
            let totalDx = 0;
            let totalDy = 0;
            for (let i = 1; i < velocitySamples.length; i++) {
              totalDx += velocitySamples[i].vx;
              totalDy += velocitySamples[i].vy;
            }
            // Convert accumulated px over dt ms → px per 16ms frame
            let vx = (totalDx / dt) * 16;
            let vy = (totalDy / dt) * 16;

            // Cap maximum velocity to prevent jarring jumps
            const speed = Math.hypot(vx, vy);
            if (speed > InertiaMaxVelocity) {
              const scale = InertiaMaxVelocity / speed;
              vx *= scale;
              vy *= scale;
            }

            if (speed >= InertiaMinVelocity) {
              const step = () => {
                vx *= InertiaFriction;
                vy *= InertiaFriction;
                if (Math.hypot(vx, vy) < InertiaMinVelocity) {
                  inertiaFrame = null;
                  return;
                }
                const z = sheetRef.current?.getZoom() ?? 1;
                sheetRef.current?.panBy(-vx / z, -vy / z);
                inertiaFrame = requestAnimationFrame(step);
              };
              inertiaFrame = requestAnimationFrame(step);
            }
          }
        }
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
      cancelInertia();
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      panning = false;
      hadMultiTouch = false;
      pinching = false;
      longPressFired = false;
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      cancelInertia();
      if (longPressTimer) clearTimeout(longPressTimer);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [containerRef, enabled, isMobile, sheetRef]);
}
