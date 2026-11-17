import type { SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { STICKY_COLORS } from "./sticky";

export interface StickyControlsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  /** Selected element ids; the toolbar only mounts this when all are stickies. */
  ids: readonly string[];
  /**
   * `"inline"` (default) lays the six swatches out in the toolbar.
   * `"menu"` folds them behind one trigger showing the current colour —
   * the phone's toolbar, where six 44px swatches plus Undo/Redo and
   * Arrange are wider than a 393px row and Arrange ended up off-screen.
   */
  variant?: "inline" | "menu";
}

/**
 * The object toolbar for a sticky-note selection: the six sticky colours,
 * inline.
 *
 * A sticky is a `roundRect` shape underneath, so without this it got the
 * rectangle's controls — border weight and dash, and a fill picker with
 * forty swatches and a gradient tab — none of which a sticky wants, while
 * the one thing people do change on a sticky (its colour) took two clicks
 * into that picker. FigJam and Miro both put the sticky palette straight
 * on the selection toolbar.
 *
 * The current colour is pressed only when every selected sticky shares
 * it, so a mixed selection shows none pressed rather than lying.
 */
export function StickyControls({
  editor,
  store,
  ids,
  variant = "inline",
}: StickyControlsProps) {
  const slide = store?.read().slides[0];
  const fills = ids.map((id) => {
    const el = slide?.elements.find((e) => e.id === id);
    if (el?.type !== "shape") return undefined;
    const fill = el.data.fill;
    return fill?.kind === "srgb" ? fill.value.toUpperCase() : undefined;
  });
  const shared = fills.every((f) => f === fills[0]) ? fills[0] : undefined;
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

  if (variant === "menu") {
    const current = STICKY_COLORS.find((c) => c.value.toUpperCase() === shared);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Sticky note color: ${current?.name ?? "Mixed"}`}
            disabled={disabled}
            className="focus-ring inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <span
              aria-hidden="true"
              className="size-5 rounded-sm border border-black/15"
              style={{ backgroundColor: current?.value ?? "transparent" }}
            />
            <IconChevronDown size={12} aria-hidden="true" className="opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className="flex gap-1 p-1"
        >
          {STICKY_COLORS.map((c) => (
            <DropdownMenuItem
              key={c.value}
              aria-label={c.name}
              title={c.name}
              className={cn(
                "size-7 rounded border border-black/15 p-0 pointer-coarse:size-11",
                shared === c.value.toUpperCase() &&
                  "ring-2 ring-primary ring-offset-1 ring-offset-background",
              )}
              style={{ backgroundColor: c.value }}
              onSelect={() => apply(c.value)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div role="group" aria-label="Sticky note color" className="flex items-center gap-0.5">
      {STICKY_COLORS.map((c) => {
        const pressed = shared === c.value.toUpperCase();
        return (
          <Tooltip key={c.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={c.name}
                aria-pressed={pressed}
                disabled={disabled}
                onClick={() => apply(c.value)}
                className="focus-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-11"
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
}
