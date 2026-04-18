import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import { parseRef, toSref, type Sref, type SheetImage, Spreadsheet } from "@wafflebase/sheets";
import type { SpreadsheetDocument } from "@/types/worksheet";
import { getOrLoadImage } from "./image-cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImageObjectLayerProps = {
  spreadsheet: Spreadsheet | undefined;
  root: SpreadsheetDocument;
  tabId: string;
  readOnly: boolean;
  selectedImageId: string | null;
  onSelectImage: (imageId: string | null) => void;
  onUpdateImage: (imageId: string, patch: Partial<SheetImage>) => void;
  onDeleteImage: (imageId: string) => void;
  renderVersion: number;
};

type DraftLayout = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type HandlePosition =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

type DragState = {
  imageId: string;
  mode: "move" | "resize";
  handle?: HandlePosition;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  startWidth: number;
  startHeight: number;
  aspectRatio: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_IMAGE_SIZE = 20;
const HANDLE_SIZE = 8;
const SELECTION_COLOR = "#1a73e8";

const HANDLES: readonly HandlePosition[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

const HANDLE_CURSORS: Record<HandlePosition, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

// ---------------------------------------------------------------------------
// ImageObjectLayer
// ---------------------------------------------------------------------------

export function ImageObjectLayer({
  spreadsheet,
  root,
  tabId,
  readOnly,
  selectedImageId,
  onSelectImage,
  onUpdateImage,
  onDeleteImage,
  renderVersion,
}: ImageObjectLayerProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLayout>>({});

  // Force re-render when images finish loading.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const images = Object.values(root.sheets[tabId]?.images || {});

  // Keyboard handler for image shortcuts (delete, move, escape).
  useEffect(() => {
    if (!selectedImageId || readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Don't intercept when user is typing in an external input (dialog, etc.).
      // The grid's own cell input (contentEditable div) is NOT external.
      const target = event.target;
      if (target instanceof Element) {
        const grid = document.querySelector("[data-sheet-container]");
        if (!grid?.contains(target)) {
          const tag = target.tagName;
          if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            (target as HTMLElement).isContentEditable
          ) {
            return;
          }
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        onDeleteImage(selectedImageId);
        onSelectImage(null);
      } else if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
      ) {
        event.preventDefault();
        event.stopPropagation();
        const dx =
          event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0;
        const dy =
          event.key === "ArrowUp" ? -10 : event.key === "ArrowDown" ? 10 : 0;
        onUpdateImage(selectedImageId, {
          offsetX:
            (images.find((i) => i.id === selectedImageId)?.offsetX ?? 0) + dx,
          offsetY:
            (images.find((i) => i.id === selectedImageId)?.offsetY ?? 0) + dy,
        });
      } else if (event.key === "Escape") {
        event.stopPropagation();
        onSelectImage(null);
      }
    };
    // Use capture phase on document so this fires before the grid's
    // keydown handler (which also listens on document in bubble phase).
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [selectedImageId, readOnly, onDeleteImage, onSelectImage, onUpdateImage, images]);

  // Drag/resize handler.
  useEffect(() => {
    if (!dragState || readOnly) return;

    let latestX = dragState.startX;
    let latestY = dragState.startY;

    const toDraft = (clientX: number, clientY: number): DraftLayout => {
      const z = spreadsheet?.getZoom() ?? 1;
      const deltaX = (clientX - dragState.startX) / z;
      const deltaY = (clientY - dragState.startY) / z;

      if (dragState.mode === "move") {
        return {
          offsetX: dragState.startOffsetX + deltaX,
          offsetY: dragState.startOffsetY + deltaY,
          width: dragState.startWidth,
          height: dragState.startHeight,
        };
      }

      // Resize mode.
      const handle = dragState.handle!;
      const hasEast = handle === "ne" || handle === "e" || handle === "se";
      const hasWest = handle === "nw" || handle === "w" || handle === "sw";
      const hasNorth = handle === "nw" || handle === "n" || handle === "ne";
      const hasSouth = handle === "sw" || handle === "s" || handle === "se";

      let newWidth = dragState.startWidth;
      let newHeight = dragState.startHeight;
      let newOffsetX = dragState.startOffsetX;
      let newOffsetY = dragState.startOffsetY;

      if (hasEast) newWidth = dragState.startWidth + deltaX;
      if (hasWest) {
        newWidth = dragState.startWidth - deltaX;
        newOffsetX = dragState.startOffsetX + deltaX;
      }
      if (hasSouth) newHeight = dragState.startHeight + deltaY;
      if (hasNorth) {
        newHeight = dragState.startHeight - deltaY;
        newOffsetY = dragState.startOffsetY + deltaY;
      }

      // Corner handles lock aspect ratio.
      const isCorner = (hasEast || hasWest) && (hasNorth || hasSouth);
      if (isCorner && dragState.aspectRatio > 0) {
        const wScale = newWidth / dragState.startWidth;
        const hScale = newHeight / dragState.startHeight;
        const scale =
          Math.abs(wScale - 1) >= Math.abs(hScale - 1) ? wScale : hScale;
        const aspectWidth = dragState.startWidth * scale;
        const aspectHeight = dragState.startHeight * scale;

        // Adjust offset for west/north-anchored handles.
        if (hasWest) {
          newOffsetX =
            dragState.startOffsetX +
            (dragState.startWidth - aspectWidth);
        }
        if (hasNorth) {
          newOffsetY =
            dragState.startOffsetY +
            (dragState.startHeight - aspectHeight);
        }
        newWidth = aspectWidth;
        newHeight = aspectHeight;
      }

      // Clamp minimum size.
      if (newWidth < MIN_IMAGE_SIZE) {
        if (hasWest) {
          newOffsetX -= MIN_IMAGE_SIZE - newWidth;
        }
        newWidth = MIN_IMAGE_SIZE;
      }
      if (newHeight < MIN_IMAGE_SIZE) {
        if (hasNorth) {
          newOffsetY -= MIN_IMAGE_SIZE - newHeight;
        }
        newHeight = MIN_IMAGE_SIZE;
      }

      return {
        offsetX: newOffsetX,
        offsetY: newOffsetY,
        width: newWidth,
        height: newHeight,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      latestX = event.clientX;
      latestY = event.clientY;
      const nextDraft = toDraft(latestX, latestY);
      setDrafts((prev) => ({
        ...prev,
        [dragState.imageId]: nextDraft,
      }));
    };

    const onPointerUp = () => {
      const nextDraft = toDraft(latestX, latestY);

      // For move operations, re-anchor to the cell under the image's
      // top-left corner so structural operations (row/col insert/delete)
      // act on the correct cell.
      if (dragState.mode === "move" && spreadsheet) {
        const image = images.find((i) => i.id === dragState.imageId);
        if (image) {
          const z = spreadsheet.getZoom() ?? 1;
          let anchorRect;
          try {
            anchorRect = spreadsheet.getCellRectInScrollableViewport(
              parseRef(image.anchor),
            );
          } catch {
            /* keep current anchor */
          }
          if (anchorRect) {
            const absX = anchorRect.left + nextDraft.offsetX * z;
            const absY = anchorRect.top + nextDraft.offsetY * z;
            const newRef = spreadsheet.cellRefFromPoint(absX, absY);
            if (newRef) {
              let newAnchorRect;
              try {
                newAnchorRect =
                  spreadsheet.getCellRectInScrollableViewport(newRef);
              } catch {
                /* keep current anchor */
              }
              if (newAnchorRect) {
                onUpdateImage(dragState.imageId, {
                  anchor: toSref(newRef) as Sref,
                  offsetX: (absX - newAnchorRect.left) / z,
                  offsetY: (absY - newAnchorRect.top) / z,
                  width: nextDraft.width,
                  height: nextDraft.height,
                });
                setDrafts((prev) => {
                  const remaining = { ...prev };
                  delete remaining[dragState.imageId];
                  return remaining;
                });
                setDragState(null);
                return;
              }
            }
          }
        }
      }

      onUpdateImage(dragState.imageId, nextDraft);
      setDrafts((prev) => {
        const remaining = { ...prev };
        delete remaining[dragState.imageId];
        return remaining;
      });
      setDragState(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragState, images, onUpdateImage, readOnly, spreadsheet]);

  const onImageLoad = useCallback(() => {
    forceUpdate();
  }, []);

  if (!spreadsheet || images.length === 0) {
    return null;
  }

  const zoom = spreadsheet.getZoom();
  const viewport = spreadsheet.getGridViewportRect();
  const scrollableViewport = spreadsheet.getScrollableGridViewportRect();
  const clipLeft = Math.max(0, scrollableViewport.left - viewport.left);
  const clipTop = Math.max(0, scrollableViewport.top - viewport.top);
  const clipWidth = Math.max(0, scrollableViewport.width);
  const clipHeight = Math.max(0, scrollableViewport.height);

  if (clipWidth === 0 || clipHeight === 0) {
    return null;
  }

  return (
    <div
      className="absolute pointer-events-none overflow-hidden"
      data-render-version={renderVersion}
      style={{
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
        zIndex: 3,
      }}
    >
      <div
        className="absolute pointer-events-none overflow-hidden"
        style={{
          left: clipLeft,
          top: clipTop,
          width: clipWidth,
          height: clipHeight,
        }}
      >
        <div
          className="relative h-full w-full pointer-events-none"
          style={{
            left: -clipLeft,
            top: -clipTop,
            width: viewport.width,
            height: viewport.height,
          }}
        >
          {images.map((image) => {
            const layout = drafts[image.id] || {
              offsetX: image.offsetX,
              offsetY: image.offsetY,
              width: image.width,
              height: image.height,
            };
            return (
              <ImageObject
                key={image.id}
                image={image}
                spreadsheet={spreadsheet}
                zoom={zoom}
                selected={selectedImageId === image.id}
                readOnly={readOnly}
                layout={layout}
                onImageLoad={onImageLoad}
                onSelect={() => onSelectImage(image.id)}
                onMoveStart={(event) => {
                  onSelectImage(image.id);
                  setDragState({
                    imageId: image.id,
                    mode: "move",
                    startX: event.clientX,
                    startY: event.clientY,
                    startOffsetX: layout.offsetX,
                    startOffsetY: layout.offsetY,
                    startWidth: layout.width,
                    startHeight: layout.height,
                    aspectRatio:
                      layout.height > 0 ? layout.width / layout.height : 1,
                  });
                }}
                onResizeStart={(event, handle) => {
                  onSelectImage(image.id);
                  setDragState({
                    imageId: image.id,
                    mode: "resize",
                    handle,
                    startX: event.clientX,
                    startY: event.clientY,
                    startOffsetX: layout.offsetX,
                    startOffsetY: layout.offsetY,
                    startWidth: layout.width,
                    startHeight: layout.height,
                    aspectRatio:
                      layout.height > 0 ? layout.width / layout.height : 1,
                  });
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageObject
// ---------------------------------------------------------------------------

function ImageObject({
  image,
  spreadsheet,
  zoom,
  selected,
  readOnly,
  layout,
  onImageLoad,
  onSelect,
  onMoveStart,
  onResizeStart,
}: {
  image: SheetImage;
  spreadsheet: Spreadsheet;
  zoom: number;
  selected: boolean;
  readOnly: boolean;
  layout: DraftLayout;
  onImageLoad: () => void;
  onSelect: () => void;
  onMoveStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeStart: (
    event: ReactPointerEvent<HTMLDivElement>,
    handle: HandlePosition,
  ) => void;
}) {
  let anchorRect;
  try {
    anchorRect = spreadsheet.getCellRectInScrollableViewport(
      parseRef(image.anchor),
    );
  } catch {
    return null;
  }
  const left = anchorRect.left + layout.offsetX * zoom;
  const top = anchorRect.top + layout.offsetY * zoom;
  const scaledWidth = layout.width * zoom;
  const scaledHeight = layout.height * zoom;

  const loadedImg = getOrLoadImage(image.src, onImageLoad);

  return (
    <div
      className="pointer-events-auto absolute"
      style={{
        left,
        top,
        width: scaledWidth,
        height: scaledHeight,
        cursor: readOnly ? "default" : "move",
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {/* Image content or placeholder */}
      {loadedImg ? (
        <img
          src={image.src}
          alt={image.alt || ""}
          draggable={false}
          className="h-full w-full select-none"
          style={{ objectFit: "fill" }}
          onPointerDown={(event) => {
            if (readOnly) return;
            event.preventDefault();
            event.stopPropagation();
            onMoveStart(event);
          }}
        />
      ) : (
        <div
          className="h-full w-full"
          style={{ backgroundColor: "#f0f0f0" }}
          onPointerDown={(event) => {
            if (readOnly) return;
            event.preventDefault();
            event.stopPropagation();
            onMoveStart(event);
          }}
        />
      )}

      {/* Selection overlay */}
      {selected && (
        <SelectionOverlay
          width={scaledWidth}
          height={scaledHeight}
          readOnly={readOnly}
          onResizeStart={onResizeStart}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectionOverlay
// ---------------------------------------------------------------------------

function SelectionOverlay({
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
      case "nw":
        return { ...base, left: -half, top: -half };
      case "n":
        return { ...base, left: width / 2 - half, top: -half };
      case "ne":
        return { ...base, left: width - half, top: -half };
      case "e":
        return { ...base, left: width - half, top: height / 2 - half };
      case "se":
        return { ...base, left: width - half, top: height - half };
      case "s":
        return { ...base, left: width / 2 - half, top: height - half };
      case "sw":
        return { ...base, left: -half, top: height - half };
      case "w":
        return { ...base, left: -half, top: height / 2 - half };
    }
  };

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        border: `1px solid ${SELECTION_COLOR}`,
      }}
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
