import { useState } from "react";
import type { SlidesEditor, SlidesStore } from "@wafflebase/slides";
import {
  SECTION_COLORS,
  listSections,
  sectionColorOf,
  sectionOf,
} from "@wafflebase/board";
import {
  IconEye,
  IconEyeOff,
  IconLayoutNavbar,
  IconListDetails,
  IconLock,
  IconPencil,
} from "@tabler/icons-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { BoardSections } from "./board-sections";
import {
  readElements,
  setSectionColor,
  updateSectionMeta,
  useSectionToolArmed,
} from "./board-sections";

/**
 * The section tool (Shift+S), an insert tool: it lives in the board's
 * tool dock.
 */
export function SectionToolToggle({
  sections,
  disabled,
}: {
  sections: BoardSections | null;
  disabled?: boolean;
}) {
  const armed = useSectionToolArmed(sections);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={armed}
          onPressedChange={(pressed) => sections?.tool.set(pressed)}
          aria-label="Section"
          disabled={disabled || !sections}
        >
          {/* A frame with a title bar, which is what a section is.
              IconFrame's crossed crop marks read as "#", like the grid. */}
          <IconLayoutNavbar size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Section (Shift+S)</TooltipContent>
    </Tooltip>
  );
}

/**
 * The sections list, which frames a section on click. Navigation rather
 * than insertion, so it stays in the top bar beside Zoom.
 */
export function SectionsListMenu({
  sections,
  store,
}: {
  sections: BoardSections | null;
  store: SlidesStore | null;
}) {
  // Read when the menu opens, not per render: the list is only needed then.
  const [open, setOpen] = useState(false);
  const list = open && store ? listSections(readElements(store)) : [];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              aria-label="Sections"
              disabled={!sections || !store}
            >
              <IconListDetails size={16} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Sections</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-80 min-w-48 overflow-y-auto">
        <DropdownMenuLabel>Sections</DropdownMenuLabel>
        {list.length === 0 && (
          <DropdownMenuItem disabled>No sections yet</DropdownMenuItem>
        )}
        {list.map(({ id, meta }) => (
          <DropdownMenuItem key={id} onSelect={() => sections?.goTo(id)}>
            <span className="truncate">{meta.title.trim() || "Untitled section"}</span>
            {meta.locked && <IconLock size={14} aria-label="Locked" className="ml-auto opacity-60" />}
            {meta.hidden && <IconEyeOff size={14} aria-label="Hidden" className={cn(!meta.locked && "ml-auto", "opacity-60")} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The object toolbar for a selection made only of sections: rename, the
 * section palette, hide/reveal and lock — in place of the rectangle's
 * border and fill controls, none of which a section wants.
 *
 * Lock has no "unlock" twin here: a locked section cannot be selected.
 * It is unlocked from the canvas menu or the sections list's go-to.
 */
export function SectionControls({
  sections,
  store,
  editor,
  ids,
}: {
  sections: BoardSections | null;
  store: SlidesStore | null;
  /** Cleared after a lock: a locked section must not stay draggable. */
  editor?: Pick<SlidesEditor, "setSelection"> | null;
  ids: readonly string[];
}) {
  const elements = store ? readElements(store) : [];
  const selected = ids.map((id) => elements.find((e) => e.id === id));
  const metas = selected.map((el) => sectionOf(el));
  const colors = selected.map((el) => sectionColorOf(el).name);
  const sharedColor = colors.every((c) => c === colors[0]) ? colors[0] : undefined;
  const allHidden = metas.length > 0 && metas.every((m) => m?.hidden);
  const disabled = !store || !sections;

  return (
    <div role="group" aria-label="Section" className="flex items-center gap-0.5">
      {ids.length === 1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              aria-label="Rename section"
              disabled={disabled}
              onClick={() => sections?.rename(ids[0])}
            >
              <IconPencil size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rename section</TooltipContent>
        </Tooltip>
      )}
      {SECTION_COLORS.map((c) => {
        const pressed = sharedColor === c.name;
        return (
          <Tooltip key={c.name}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={c.name}
                aria-pressed={pressed}
                disabled={disabled}
                onClick={() => store && setSectionColor(store, ids, c)}
                className="focus-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-11"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-5 rounded-sm border-2",
                    pressed && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  )}
                  style={{ backgroundColor: c.fill, borderColor: c.stroke }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{c.name}</TooltipContent>
          </Tooltip>
        );
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={allHidden}
            aria-label={allHidden ? "Reveal contents" : "Hide contents"}
            disabled={disabled}
            onPressedChange={(pressed) => {
              if (!store) return;
              store.batch(() => {
                for (const id of ids) updateSectionMeta(store, id, { hidden: pressed });
              });
            }}
          >
            {allHidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>{allHidden ? "Reveal contents" : "Hide contents"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            aria-label="Lock section"
            disabled={disabled}
            onClick={() => {
              if (!store) return;
              store.batch(() => {
                for (const id of ids) updateSectionMeta(store, id, { locked: true });
              });
              editor?.setSelection([]);
            }}
          >
            <IconLock size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Lock section</TooltipContent>
      </Tooltip>
    </div>
  );
}
