import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { parseRef, type SheetImage, Spreadsheet } from "@wafflebase/sheets";
import { type DraftLayout, type HandlePosition } from "./object-layer-utils";
import { SelectionOverlay } from "./selection-overlay";
import { ObjectLayerViewport } from "./object-layer-viewport";
import { useObjectKeyboardShortcuts, useObjectDragResize } from "./use-object-layer";
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
  // Force re-render when images finish loading.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const images = Object.values(root.sheets[tabId]?.images || {});

  useObjectKeyboardShortcuts({
    selectedId: selectedImageId,
    readOnly,
    items: images,
    onDelete: onDeleteImage,
    onDeselect: () => onSelectImage(null),
    onUpdate: onUpdateImage,
  });

  const { setDragState, drafts } = useObjectDragResize({
    readOnly,
    spreadsheet,
    lockAspectRatio: true,
    items: images,
    onUpdate: onUpdateImage,
  });

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

  return (
    <ObjectLayerViewport
      spreadsheet={spreadsheet}
      zIndex={3}
      renderVersion={renderVersion}
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
                objectId: image.id,
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
                objectId: image.id,
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
    </ObjectLayerViewport>
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
