import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { parseRef, type SheetImage, Spreadsheet } from "@wafflebase/sheets";
import {
  type DraftLayout,
  type HandlePosition,
  computeResizeDraft,
  reanchorAfterMove,
} from "./object-layer-utils";
import { SelectionOverlay } from "./selection-overlay";
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
  const imagesRef = useRef(images);
  imagesRef.current = images;

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

      // Resize mode — images lock aspect ratio on corner handles.
      return computeResizeDraft({
        handle: dragState.handle!,
        deltaX,
        deltaY,
        startOffsetX: dragState.startOffsetX,
        startOffsetY: dragState.startOffsetY,
        startWidth: dragState.startWidth,
        startHeight: dragState.startHeight,
        aspectRatio: dragState.aspectRatio,
        lockAspectRatio: true,
      });
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
      const imageId = dragState.imageId;

      // For move operations, re-anchor to the cell under the pointer
      // so row/column insert/delete correctly shifts the image.
      if (dragState.mode === "move" && spreadsheet) {
        const img = imagesRef.current.find((i) => i.id === imageId);
        if (img) {
          const patch = reanchorAfterMove({
            spreadsheet,
            pointerX: latestX,
            pointerY: latestY,
            currentAnchor: img.anchor,
            draft: nextDraft,
          });
          if (patch) {
            onUpdateImage(imageId, patch);
            setDrafts((prev) => {
              const remaining = { ...prev };
              delete remaining[imageId];
              return remaining;
            });
            setDragState(null);
            return;
          }
        }
      }

      onUpdateImage(imageId, nextDraft);
      setDrafts((prev) => {
        const remaining = { ...prev };
        delete remaining[imageId];
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
  }, [dragState, onUpdateImage, readOnly, spreadsheet]);

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onImageLoad = useCallback(() => {
    if (mountedRef.current) forceUpdate();
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

