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

/**
 * Split-button that enters present mode. Primary click starts from the
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
  return (
    <div className="inline-flex items-center rounded-md border">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onStart("current")}
            disabled={disabled}
            aria-label="Present from current slide"
            className="inline-flex h-8 w-8 items-center justify-center rounded-l-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <IconPlayerPlay size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Present</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Present options"
            className="inline-flex h-8 w-6 items-center justify-center rounded-r-md border-l hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
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
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => onStart("first")}
          >
            Present from beginning
            <span className="ml-auto pl-4 text-xs text-muted-foreground">
              {modKey}⇧↵
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
