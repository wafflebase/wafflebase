import { IconPlayerPlay, IconChevronDown } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HEADER_CONTROL_SIZE,
  useHeaderPlacement,
} from "@/components/header-placement";

/**
 * Split-button that enters present mode, labelled "Slideshow" as in
 * Google Slides (an icon-only play glyph read as "media", not "present",
 * to people arriving from there). Primary click starts from the
 * editor's current slide; the chevron's dropdown offers "from beginning"
 * (mirroring Google Slides). The two menu items also surface the
 * keyboard shortcut hints — the corresponding bindings live in the
 * editor and dispatch through the same `onStart` callback used here.
 */
interface PresentButtonProps {
  disabled: boolean;
  onStart: (from: "current" | "first") => void;
}

export function PresentButton({ disabled, onStart }: PresentButtonProps) {
  const modKey =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac")
      ? "⌘"
      : "Ctrl";
  const placement = useHeaderPlacement();

  const fromBeginning = (
    <DropdownMenuItem
      className="cursor-pointer"
      inset={placement === "menu"}
      disabled={disabled}
      onSelect={() => onStart("first")}
    >
      Present from beginning
      {/* A phone has no keyboard to take the hint. */}
      {placement !== "menu" && (
        <span className="ml-auto pl-4 text-xs text-muted-foreground">
          {modKey}⇧↵
        </span>
      )}
    </DropdownMenuItem>
  );

  // On a phone the row keeps one square play button, sized like its
  // neighbours, and the chevron's choice moves to the header's More menu
  // (where the bar's own action, "from current slide", needs no row).
  if (placement === "menu") return fromBeginning;
  if (placement === "compact") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onStart("current")}
            disabled={disabled}
            aria-label="Slideshow"
            className={`focus-ring inline-flex ${HEADER_CONTROL_SIZE} shrink-0 cursor-pointer items-center justify-center rounded-md border hover:bg-muted disabled:pointer-events-none disabled:opacity-50`}
          >
            <IconPlayerPlay size={16} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Present from current slide</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="inline-flex items-center rounded-md border">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onStart("current")}
            disabled={disabled}
            className="inline-flex h-8 min-w-8 pointer-coarse:h-11 cursor-pointer items-center justify-center gap-1.5 rounded-l-md px-2 text-sm font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-50 md:pr-2.5"
          >
            <IconPlayerPlay size={16} aria-hidden="true" />
            {/* The visible label is the accessible name (no aria-label, so
                the two cannot drift). Below md the header renders the
                `compact` form above instead; screen-reader-only covers
                the first paint, before the viewport is known. */}
            <span className="sr-only md:not-sr-only">Slideshow</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Present from current slide ({modKey}↵)
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Present options"
            className="inline-flex h-8 w-6 pointer-coarse:h-11 cursor-pointer items-center justify-center rounded-r-md border-l hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconChevronDown size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => onStart("current")}
          >
            Present from current slide
            <span className="ml-auto pl-4 text-xs text-muted-foreground">
              {modKey}↵
            </span>
          </DropdownMenuItem>
          {fromBeginning}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
