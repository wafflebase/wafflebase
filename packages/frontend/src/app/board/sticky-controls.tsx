import type { Element, SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { IconChevronDown, IconMinus, IconPlus, IconUser } from "@tabler/icons-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ToolbarSeparator } from "@/components/ui/toolbar";
import { cn } from "@/lib/utils";
import { STICKY_COLORS } from "./sticky";
import {
  STICKY_SIZE_PRESETS,
  applyStickyFontSize,
  applyStickyShowAuthor,
  applyStickySize,
  hasAnonymity,
  stepStickyFontSize,
  stickyFontSize,
  stickyHasAuthor,
  stickyShowsAuthor,
  stickySizePresetOf,
} from "./sticky-format";

export interface StickyControlsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  /** Selected sticky ids (the toolbar passes only the stickies). */
  ids: readonly string[];
  /**
   * Only the colour row: for a mixed selection that contains stickies,
   * where the rest of the toolbar belongs to the other elements.
   */
  colorsOnly?: boolean;
}

const BUTTON =
  "focus-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-11";

/**
 * The size-preset trigger, one width for every label ("Small" … "Medium",
 * "Size"), so the controls after it never shift when the preset changes.
 */
export const STICKY_SIZE_TRIGGER = "h-8 w-20 shrink-0 justify-between gap-1 px-2";

/** `values[0]` when every value equals it, else `undefined`. */
function shared<T>(values: readonly T[]): T | undefined {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
}

/**
 * The object toolbar for a sticky-note selection: the six sticky colours
 * inline, then size presets, text size and the author tag.
 *
 * A sticky is a `roundRect` shape underneath, so without this it got the
 * rectangle's controls — border weight and dash, and a fill picker with
 * forty swatches and a gradient tab — none of which a sticky wants, while
 * the one thing people do change on a sticky (its colour) took two clicks
 * into that picker. FigJam and Miro both put the sticky palette straight
 * on the selection toolbar.
 *
 * Every control reports a value only when the whole selection shares it,
 * so a mixed selection shows nothing pressed rather than lying. Every
 * change is one batch, so one undo.
 */
export function StickyControls({ editor, store, ids, colorsOnly }: StickyControlsProps) {
  const elements: readonly Element[] = store?.read().slides[0]?.elements ?? [];
  const selected = ids
    .map((id) => elements.find((e) => e.id === id))
    .filter((e): e is Element => e !== undefined);
  const fills = selected.map((el) => {
    if (el.type !== "shape") return undefined;
    const fill = el.data.fill;
    return fill && "kind" in fill && fill.kind === "srgb" ? fill.value.toUpperCase() : undefined;
  });
  const sharedFill = fills.length === ids.length ? shared(fills) : undefined;
  const disabled = !editor || !store;

  const apply = (value: string) => {
    if (!store) return;
    store.batch(() => {
      for (const id of ids) {
        store.updateElementData(SYNTHETIC_SLIDE_ID, id, {
          fill: { kind: "srgb", value },
        });
      }
    });
  };

  const colors = (
    <div role="group" aria-label="Sticky note color" className="flex items-center gap-0.5">
      {STICKY_COLORS.map((c) => {
        const pressed = sharedFill === c.value.toUpperCase();
        return (
          <Tooltip key={c.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={c.name}
                aria-pressed={pressed}
                disabled={disabled}
                onClick={() => apply(c.value)}
                className={BUTTON}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-5 rounded-sm border border-black/15",
                    pressed && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  )}
                  style={{ backgroundColor: c.value }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{c.name}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
  if (colorsOnly) return colors;

  const sizePreset = shared(selected.map((el) => (el.frame ? stickySizePresetOf(el.frame)?.id : undefined)));
  const fontSize = shared(selected.map(stickyFontSize));
  const currentSize = fontSize ?? Math.max(...selected.map(stickyFontSize), 0);
  const anonymous = hasAnonymity(store) && store.isAnonymous();
  const authored = selected.filter(stickyHasAuthor);
  const authorShown = authored.length > 0 && authored.every(stickyShowsAuthor);

  const stepFont = (direction: 1 | -1) => {
    if (!store) return;
    applyStickyFontSize(store, elements, ids, stepStickyFontSize(currentSize, direction));
  };

  return (
    <div className="flex items-center gap-0.5">
      {colors}
      <ToolbarSeparator className="mx-1" />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                // Fixed width: "Small" and "Medium" differ, and a trigger that
                // resizes with its label moves the A−/A+ buttons after it, so
                // a second click lands on the next control over.
                className={STICKY_SIZE_TRIGGER}
                disabled={disabled}
                aria-label={`Sticky size: ${
                  STICKY_SIZE_PRESETS.find((p) => p.id === sizePreset)?.label ?? "Custom"
                }`}
              >
                <span className="truncate text-xs">
                  {STICKY_SIZE_PRESETS.find((p) => p.id === sizePreset)?.label ?? "Size"}
                </span>
                <IconChevronDown aria-hidden="true" className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Sticky size</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={sizePreset ?? ""}
            onValueChange={(value) => {
              const preset = STICKY_SIZE_PRESETS.find((p) => p.id === value);
              if (store && preset) applyStickySize(store, elements, ids, preset);
            }}
          >
            {STICKY_SIZE_PRESETS.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {p.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div role="group" aria-label="Sticky text size" className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Decrease text size"
              disabled={disabled}
              onClick={() => stepFont(-1)}
              className={BUTTON}
            >
              <IconMinus aria-hidden="true" className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Decrease text size</TooltipContent>
        </Tooltip>
        <span
          aria-live="polite"
          aria-label="Text size"
          className="w-7 text-center text-xs tabular-nums"
        >
          {fontSize ?? "–"}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Increase text size"
              disabled={disabled}
              onClick={() => stepFont(1)}
              className={BUTTON}
            >
              <IconPlus aria-hidden="true" className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Increase text size</TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A span keeps the tooltip working on the disabled button. */}
          <span className="inline-flex">
            <button
              type="button"
              aria-label="Show author"
              aria-pressed={authorShown && !anonymous}
              disabled={disabled || anonymous || authored.length === 0}
              onClick={() => store && applyStickyShowAuthor(store, ids, !authorShown)}
              className={cn(BUTTON, authorShown && !anonymous && "bg-muted")}
            >
              <IconUser aria-hidden="true" className="size-4" />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {anonymous
            ? "Author names are hidden on this board"
            : authored.length === 0
              ? "No author recorded"
              : "Show author"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
