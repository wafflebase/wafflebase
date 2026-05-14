import { IconPlayerPlay, IconChevronDown } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
      <button
        type="button"
        onClick={() => onStart("current")}
        disabled={disabled}
        aria-label="Present from current slide"
        className="inline-flex h-8 items-center gap-1.5 rounded-l-md px-3 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
      >
        <IconPlayerPlay size={16} />
        <span>Present</span>
      </button>
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
