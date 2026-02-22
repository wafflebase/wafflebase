import { ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { IconPhoto, IconUpload, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SheetImage } from "@/types/worksheet";

type ImageEditorPanelProps = {
  image: SheetImage | undefined;
  open: boolean;
  onClose: () => void;
  onUpdateImage: (imageId: string, patch: Partial<SheetImage>) => void;
  onReplaceImage: (imageId: string, file: File) => Promise<void>;
};

/**
 * Renders the ImageEditorPanel component.
 */
export function ImageEditorPanel({
  image,
  open,
  onClose,
  onUpdateImage,
  onReplaceImage,
}: ImageEditorPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (!open || !image) {
    return null;
  }

  const handleClickReplace = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleReplaceChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    event.target.value = "";
    if (!nextFile) return;

    if (!nextFile.type.startsWith("image/")) {
      toast.error("Select a valid image file.");
      return;
    }

    setUploading(true);
    try {
      await onReplaceImage(image.id, nextFile);
      toast.success("Image replaced.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to replace image.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-80 flex-col overflow-hidden border-l bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconPhoto size={16} className="text-primary" />
            <p className="text-sm font-semibold">Image editor</p>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            Key: {image.key}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="Close image editor"
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6">
        <section className="space-y-2">
          <Label htmlFor="image-title">Image title</Label>
          <Input
            id="image-title"
            value={image.title || ""}
            onChange={(event) =>
              onUpdateImage(image.id, {
                title: event.target.value,
              })
            }
            placeholder="Image"
          />
        </section>

        <Separator />

        <section className="space-y-2">
          <Label htmlFor="image-alt-text">Alt text</Label>
          <Input
            id="image-alt-text"
            value={image.alt || ""}
            onChange={(event) =>
              onUpdateImage(image.id, {
                alt: event.target.value,
              })
            }
            placeholder="Describe the image"
          />
        </section>

        <Separator />

        <section className="space-y-2">
          <Label htmlFor="image-fit-mode">Fit mode</Label>
          <Select
            value={image.fit}
            onValueChange={(value) => {
              onUpdateImage(image.id, {
                fit: value as SheetImage["fit"],
              });
            }}
          >
            <SelectTrigger id="image-fit-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cover">Fill frame (cover)</SelectItem>
              <SelectItem value="contain">Fit inside (contain)</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <Separator />

        <section className="space-y-2">
          <Label>Image file</Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleReplaceChange(event);
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleClickReplace}
            disabled={uploading}
          >
            <IconUpload size={14} className="mr-2" />
            {uploading ? "Uploading..." : "Replace image"}
          </Button>
        </section>
      </div>
    </aside>
  );
}
