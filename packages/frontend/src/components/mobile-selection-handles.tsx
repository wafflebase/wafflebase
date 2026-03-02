import { useCallback, useRef } from "react";
import type { Spreadsheet } from "@wafflebase/sheet";

interface MobileSelectionHandlesProps {
  spreadsheet: Spreadsheet;
  renderVersion: number;
}

const HandleSize = 20;
const HandleTouchTarget = 44;

export function MobileSelectionHandles({
  spreadsheet,
  renderVersion,
}: MobileSelectionHandlesProps) {
  const draggingRef = useRef<"start" | "end" | null>(null);

  const handleTouchStart = useCallback(
    (handle: "start" | "end") => (e: React.TouchEvent) => {
      e.stopPropagation();
      draggingRef.current = handle;

      const onTouchMove = (ev: TouchEvent) => {
        ev.preventDefault();
        const touch = ev.touches[0];
        const ref = spreadsheet.cellRefFromPoint(touch.clientX, touch.clientY);
        if (draggingRef.current === "end") {
          spreadsheet.selectEnd(ref);
        } else {
          // For top-left handle: swap anchor to bottom-right, extend to touch
          const currentRange = spreadsheet.getSelectionRangeOrActiveCell();
          if (currentRange) {
            spreadsheet.selectStart(currentRange[1]);
            spreadsheet.selectEnd(ref);
          }
        }
      };

      const onTouchEnd = () => {
        draggingRef.current = null;
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
        document.removeEventListener("touchcancel", onTouchEnd);
      };

      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd);
      document.addEventListener("touchcancel", onTouchEnd);
    },
    [spreadsheet],
  );

  // Suppress renderVersion lint — used to trigger re-render on selection change
  void renderVersion;

  const range = spreadsheet.getSelectionRangeOrActiveCell();
  if (!range) return null;

  const viewport = spreadsheet.getGridViewportRect();
  const startRect = spreadsheet.getCellRect(range[0]);
  const endRect = spreadsheet.getCellRect(range[1]);

  // Top-left handle: positioned at top-left corner of range[0]
  const tlX = viewport.left + startRect.left - HandleSize / 2;
  const tlY = viewport.top + startRect.top - HandleSize / 2;

  // Bottom-right handle: positioned at bottom-right corner of range[1]
  const brX = viewport.left + endRect.left + endRect.width - HandleSize / 2;
  const brY = viewport.top + endRect.top + endRect.height - HandleSize / 2;

  const handleStyle = (x: number, y: number): React.CSSProperties => ({
    position: "absolute",
    left: x,
    top: y,
    width: HandleSize,
    height: HandleSize,
    // Expand touch target beyond visual circle
    padding: (HandleTouchTarget - HandleSize) / 2,
    margin: -(HandleTouchTarget - HandleSize) / 2,
    zIndex: 12,
    touchAction: "none",
  });

  return (
    <>
      <div
        style={handleStyle(tlX, tlY)}
        onTouchStart={handleTouchStart("start")}
      >
        <div className="h-full w-full rounded-full bg-primary" />
      </div>
      <div
        style={handleStyle(brX, brY)}
        onTouchStart={handleTouchStart("end")}
      >
        <div className="h-full w-full rounded-full bg-primary" />
      </div>
    </>
  );
}
