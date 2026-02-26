import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react";
import { parseRef, Spreadsheet } from "@wafflebase/sheet";
import { SheetImage, SpreadsheetDocument } from "@/types/worksheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IconDotsVertical,
  IconPencil,
  IconPhoto,
  IconTrash,
} from "@tabler/icons-react";

type ImageObjectLayerProps = {
  spreadsheet: Spreadsheet | undefined;
  root: SpreadsheetDocument;
  tabId: string;
  readOnly: boolean;
  selectedImageId: string | null;
  onSelectImage: (imageId: string) => void;
  onRequestEditImage: (imageId: string) => void;
  onDeleteImage: (imageId: string) => void;
  onUpdateImage: (imageId: string, patch: Partial<SheetImage>) => void;
  renderVersion: number;
};

type DraftLayout = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type DragState = {
  imageId: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  startWidth: number;
  startHeight: number;
};

const MIN_IMAGE_WIDTH = 160;
const MIN_IMAGE_HEIGHT = 120;

/**
 * Renders the ImageObjectLayer component.
 */
export function ImageObjectLayer({
  spreadsheet,
  root,
  tabId,
  readOnly,
  selectedImageId,
  onSelectImage,
  onRequestEditImage,
  onDeleteImage,
  onUpdateImage,
  renderVersion,
}: ImageObjectLayerProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLayout>>({});

  const images = Object.values(root.sheets[tabId]?.images || {});

  useEffect(() => {
    if (!dragState || readOnly) return;

    let latestX = dragState.startX;
    let latestY = dragState.startY;

    const toDraft = (clientX: number, clientY: number): DraftLayout => {
      const deltaX = clientX - dragState.startX;
      const deltaY = clientY - dragState.startY;

      if (dragState.mode === "move") {
        return {
          offsetX: dragState.startOffsetX + deltaX,
          offsetY: dragState.startOffsetY + deltaY,
          width: dragState.startWidth,
          height: dragState.startHeight,
        };
      }

      return {
        offsetX: dragState.startOffsetX,
        offsetY: dragState.startOffsetY,
        width: Math.max(MIN_IMAGE_WIDTH, dragState.startWidth + deltaX),
        height: Math.max(MIN_IMAGE_HEIGHT, dragState.startHeight + deltaY),
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
  }, [dragState, onUpdateImage, readOnly]);

  if (!spreadsheet || images.length === 0) {
    return null;
  }

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
        zIndex: 6,
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
                selected={selectedImageId === image.id}
                readOnly={readOnly}
                layout={layout}
                onSelect={() => onSelectImage(image.id)}
                onRequestEdit={() => onRequestEditImage(image.id)}
                onDelete={() => onDeleteImage(image.id)}
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
                  });
                }}
                onResizeStart={(event) => {
                  onSelectImage(image.id);
                  setDragState({
                    imageId: image.id,
                    mode: "resize",
                    startX: event.clientX,
                    startY: event.clientY,
                    startOffsetX: layout.offsetX,
                    startOffsetY: layout.offsetY,
                    startWidth: layout.width,
                    startHeight: layout.height,
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

function ImageObject({
  image,
  spreadsheet,
  selected,
  readOnly,
  layout,
  onSelect,
  onRequestEdit,
  onDelete,
  onMoveStart,
  onResizeStart,
}: {
  image: SheetImage;
  spreadsheet: Spreadsheet;
  selected: boolean;
  readOnly: boolean;
  layout: DraftLayout;
  onSelect: () => void;
  onRequestEdit: () => void;
  onDelete: () => void;
  onMoveStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const imageUrl = `${import.meta.env.VITE_BACKEND_API_URL}/assets/images/${encodeURIComponent(image.key)}`;
  useEffect(() => {
    setLoadFailed(false);
  }, [imageUrl]);

  let anchorRect;
  try {
    anchorRect = spreadsheet.getCellRectInScrollableViewport(parseRef(image.anchor));
  } catch {
    return null;
  }
  const left = anchorRect.left + layout.offsetX;
  const top = anchorRect.top + layout.offsetY;
  const fitMode = image.fit === "contain" ? "contain" : "cover";

  return (
    <div
      className="pointer-events-auto absolute flex flex-col rounded-md border bg-background shadow-md"
      style={{
        left,
        top,
        width: layout.width,
        height: layout.height,
        borderColor: selected ? "var(--color-primary)" : undefined,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1 text-xs font-medium">
        <div
          className={`min-w-0 flex-1 ${readOnly ? "" : "cursor-move"}`}
          onPointerDown={(event) => {
            if (readOnly) return;
            event.preventDefault();
            event.stopPropagation();
            onMoveStart(event);
          }}
        >
          <span className="truncate">{image.title || "Image"}</span>
        </div>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                aria-label="Open image menu"
              >
                <IconDotsVertical size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestEdit();
                }}
              >
                <IconPencil size={14} />
                Edit image
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <IconTrash size={14} />
                Delete image
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="relative min-h-0 flex-1 bg-muted/30">
        {loadFailed ? (
          <div className="flex h-full w-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <IconPhoto size={16} />
            Failed to load image
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={image.alt || image.title || "Sheet image"}
            className="h-full w-full select-none"
            style={{ objectFit: fitMode }}
            draggable={false}
            onError={() => setLoadFailed(true)}
          />
        )}
        {!readOnly && selected && (
          <div
            className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-tl border-l border-t bg-background"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onResizeStart(event);
            }}
          />
        )}
      </div>
    </div>
  );
}
