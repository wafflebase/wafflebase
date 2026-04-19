import { type PointerEvent as ReactPointerEvent } from "react";
import {
  type HandlePosition,
  HANDLES,
  HANDLE_SIZE,
  SELECTION_COLOR,
  HANDLE_CURSORS,
} from "./object-layer-utils";

export function SelectionOverlay({
  width,
  height,
  readOnly,
  onResizeStart,
}: {
  width: number;
  height: number;
  readOnly: boolean;
  onResizeStart: (
    event: ReactPointerEvent<HTMLDivElement>,
    handle: HandlePosition,
  ) => void;
}) {
  const half = HANDLE_SIZE / 2;
  const handleStyle = (
    handle: HandlePosition,
  ): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: "absolute",
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
      backgroundColor: "#ffffff",
      border: `1px solid ${SELECTION_COLOR}`,
      boxSizing: "border-box",
      cursor: readOnly ? "default" : HANDLE_CURSORS[handle],
      pointerEvents: readOnly ? "none" : "auto",
    };
    switch (handle) {
      case "nw": return { ...base, left: -half, top: -half };
      case "n":  return { ...base, left: width / 2 - half, top: -half };
      case "ne": return { ...base, left: width - half, top: -half };
      case "e":  return { ...base, left: width - half, top: height / 2 - half };
      case "se": return { ...base, left: width - half, top: height - half };
      case "s":  return { ...base, left: width / 2 - half, top: height - half };
      case "sw": return { ...base, left: -half, top: height - half };
      case "w":  return { ...base, left: -half, top: height / 2 - half };
    }
  };

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ border: `1px solid ${SELECTION_COLOR}` }}
    >
      {HANDLES.map((handle) => (
        <div
          key={handle}
          style={handleStyle(handle)}
          onPointerDown={(event) => {
            if (readOnly) return;
            event.preventDefault();
            event.stopPropagation();
            onResizeStart(event, handle);
          }}
        />
      ))}
    </div>
  );
}
