import { useRef, useState } from "react";
import type { InsertKind } from "@wafflebase/slides";
import {
  IconLetterT,
  IconLine,
  IconNote,
  IconPhoto,
  IconPlus,
  IconShape,
} from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ShapePicker } from "../slides/shape-picker";
import { LinePicker } from "../slides/line-picker";
import { STICKY_COLORS } from "./sticky";

const ACTION_CLASS =
  "inline-flex cursor-pointer h-12 items-center gap-3 rounded-md border bg-background px-4 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

export interface BoardInsertSheetProps {
  disabled?: boolean;
  /** Arms an editor insert tool (text box, a shape, a line). */
  onInsertMode: (kind: InsertKind) => void;
  /** Drops a sticky of the given colour at the viewport center. */
  onInsertSticky?: (colorValue: string) => void;
  /** Opens the toolbar's image file picker. */
  onPickImage: () => void;
  /** No image pipeline wired (harness): mirrors the desktop Image button. */
  imageDisabled?: boolean;
}

/**
 * The phone's insert block: one "+" button in place of the desktop row's
 * Text / Sticky ▾ / Image / Shape ▾ / Line ▾, opening a bottom sheet —
 * the pattern `slides/toolbar/mobile-toolbar.tsx`'s `InsertSheet` set.
 *
 * Without it the idle board toolbar was 644px of content in a 393px
 * iPhone row: the Text box button cut mid-icon and every other insert
 * tool a swipe away.
 *
 * A sticky is inserted from the sheet's `onCloseAutoFocus`, not from the
 * click, for the reason the desktop palette does it: inserting enters the
 * sticky's text edit, and Radix's focus restore to the trigger would
 * otherwise take the caret straight back.
 */
export function BoardInsertSheet({
  disabled,
  onInsertMode,
  onInsertSticky,
  onPickImage,
  imageDisabled,
}: BoardInsertSheetProps) {
  const [open, setOpen] = useState(false);
  const pendingSticky = useRef<string | null>(null);

  const arm = (kind: InsertKind) => {
    onInsertMode(kind);
    setOpen(false);
  };
  const sticky = (value: string) => {
    pendingSticky.current = value;
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Insert"
          disabled={disabled}
          className="focus-ring inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md px-1.5 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <IconPlus size={18} />
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="pb-[env(safe-area-inset-bottom,8px)]"
        onCloseAutoFocus={(e) => {
          const color = pendingSticky.current;
          if (!color) return;
          pendingSticky.current = null;
          e.preventDefault();
          onInsertSticky?.(color);
        }}
      >
        <SheetHeader>
          <SheetTitle>Insert</SheetTitle>
          <SheetDescription className="sr-only">
            Add a sticky note, text box, image, shape, or line to the board.
          </SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-2 gap-2 px-4">
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={disabled}
            onClick={() => sticky(STICKY_COLORS[0].value)}
          >
            <IconNote size={20} />
            Sticky note
          </button>
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={disabled}
            onClick={() => arm("text")}
          >
            <IconLetterT size={20} />
            Text box
          </button>
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={disabled || imageDisabled}
            onClick={() => {
              setOpen(false);
              onPickImage();
            }}
          >
            <IconPhoto size={20} />
            Image
          </button>
          <ShapePicker
            activeKind={null}
            onSelect={arm}
            disabled={disabled}
            trigger={
              <button
                type="button"
                aria-label="Shape"
                disabled={disabled}
                className={ACTION_CLASS}
              >
                <IconShape size={20} />
                Shape
              </button>
            }
          />
          <LinePicker
            activeKind={null}
            onSelect={arm}
            disabled={disabled}
            trigger={
              <button
                type="button"
                aria-label="Line"
                disabled={disabled}
                className={ACTION_CLASS}
              >
                <IconLine size={20} />
                Line
              </button>
            }
          />
        </div>
        <p
          className="px-4 text-xs text-muted-foreground"
          id="board-insert-sticky-color"
        >
          Sticky note in a color
        </p>
        <div
          role="group"
          aria-labelledby="board-insert-sticky-color"
          className="flex flex-wrap items-center gap-2 px-4 pb-4"
        >
          {STICKY_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-label={`${c.name} sticky note`}
              disabled={disabled}
              onClick={() => sticky(c.value)}
              className="size-11 cursor-pointer rounded-md border border-black/15 disabled:pointer-events-none disabled:opacity-50"
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
