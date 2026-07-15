import type { NoteViewMode } from "@wafflebase/notes";
import { Button } from "@/components/ui/button";

const MODES: { mode: NoteViewMode; label: string }[] = [
  { mode: "edit", label: "Editor" },
  { mode: "both", label: "Split" },
  { mode: "view", label: "Preview" },
];

/**
 * Thin notes toolbar: a 3-way view-mode segmented control
 * (Editor / Split / Preview), mirroring CodePair's editor modes. Sits in the
 * same slot the docs/slides formatting toolbars occupy, so it is the natural
 * home for future markdown-formatting controls.
 *
 * Text-only (no icon imports) to avoid adding an icon chunk to the frontend
 * chunk-count budget; icons can be added later if there is headroom.
 */
export function NotesToolbar({
  mode,
  onModeChange,
}: {
  mode: NoteViewMode;
  onModeChange: (mode: NoteViewMode) => void;
}) {
  return (
    // Toolbar strip styling inlined (matching @/components/ui/toolbar) so this
    // route does not pull the shared Toolbar/Separator primitive into its own
    // hoisted chunk just for a 3-button control.
    <div
      aria-label="Note view mode"
      className="flex items-center gap-0.5 overflow-x-auto border-b bg-background px-2 py-1 whitespace-nowrap"
    >
      {MODES.map(({ mode: m, label }) => (
        <Button
          key={m}
          type="button"
          size="sm"
          variant={mode === m ? "secondary" : "ghost"}
          aria-pressed={mode === m}
          className="h-8 cursor-pointer"
          onClick={() => onModeChange(m)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

export default NotesToolbar;
