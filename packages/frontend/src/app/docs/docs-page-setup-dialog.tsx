import { useEffect, useState, type FormEvent } from "react";
import {
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES,
  type EditorAPI,
  type PageSetup,
  type PaperSize,
} from "@wafflebase/docs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * `PageSetup` stores lengths as CSS pixels at 96 dpi (see
 * docs/design/docs/docs-pagination.md), so an inch is exactly 96 px. The
 * dialog talks in inches because that is how a word processor states a
 * margin; the conversion is lossless in the direction that matters (typed
 * inches → px) and only rounds for display.
 */
const PX_PER_INCH = 96;

const PAPER_OPTIONS: PaperSize[] = [
  PAPER_SIZES.LETTER,
  PAPER_SIZES.A4,
  PAPER_SIZES.LEGAL,
];

/** Sentinel `Select` value for a paper size that matches no preset. */
const CUSTOM = "__custom__";

const MARGIN_FIELDS = [
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
] as const;

type MarginKey = (typeof MARGIN_FIELDS)[number]["key"];

/** Margins are held as raw strings so a half-typed "0." is not clobbered. */
type MarginDraft = Record<MarginKey, string>;

function toInches(px: number): string {
  // Two decimals is the granularity Google Docs offers, and 0.01 in ≈ 1 px,
  // so nothing the user can express is lost.
  return String(Number((px / PX_PER_INCH).toFixed(2)));
}

function draftFrom(setup: PageSetup): MarginDraft {
  return {
    top: toInches(setup.margins.top),
    bottom: toInches(setup.margins.bottom),
    left: toInches(setup.margins.left),
    right: toInches(setup.margins.right),
  };
}

function parseInches(value: string): number | null {
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * PX_PER_INCH);
}

export interface DocsPageSetupDialogProps {
  editor: EditorAPI | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Page Setup — paper size, orientation and margins, the three fields
 * `PageSetup` carries and nothing else.
 *
 * The pagination design deliberately left this UI out ("Page setup UI (modal
 * dialog, side panel) — deferred to frontend integration"), so the model, the
 * store setter and the repagination were already complete; this dialog is the
 * missing surface. Applying goes through `EditorAPI.setPageSetup`, which is
 * the same write path the ruler's margin drag uses — one snapshot, so one
 * undo step reverts the whole change.
 *
 * The form state is seeded on *open* rather than on mount: the editor may
 * repaginate underneath (a collaborator dragging the ruler), and re-reading
 * each time means the dialog can never show a stale setup.
 */
export function DocsPageSetupDialog({
  editor,
  open,
  onOpenChange,
}: DocsPageSetupDialogProps) {
  const [paperSize, setPaperSize] = useState<PaperSize>(
    DEFAULT_PAGE_SETUP.paperSize,
  );
  const [orientation, setOrientation] = useState<PageSetup["orientation"]>(
    DEFAULT_PAGE_SETUP.orientation,
  );
  const [margins, setMargins] = useState<MarginDraft>(() =>
    draftFrom(DEFAULT_PAGE_SETUP),
  );

  useEffect(() => {
    if (!open || !editor) return;
    const current = editor.getPageSetup();
    setPaperSize(current.paperSize);
    setOrientation(current.orientation);
    setMargins(draftFrom(current));
  }, [open, editor]);

  const parsed: Record<MarginKey, number | null> = {
    top: parseInches(margins.top),
    bottom: parseInches(margins.bottom),
    left: parseInches(margins.left),
    right: parseInches(margins.right),
  };

  // Effective page box, so the check follows the orientation the user picked.
  const pageWidth =
    orientation === "landscape" ? paperSize.height : paperSize.width;
  const pageHeight =
    orientation === "landscape" ? paperSize.width : paperSize.height;

  let error: string | null = null;
  if (Object.values(parsed).some((v) => v === null)) {
    error = "Margins must be zero or a positive number of inches.";
  } else if (parsed.left! + parsed.right! >= pageWidth) {
    error = "Left and right margins must leave room for content.";
  } else if (parsed.top! + parsed.bottom! >= pageHeight) {
    error = "Top and bottom margins must leave room for content.";
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!editor || error) return;
    editor.setPageSetup({
      paperSize,
      orientation,
      margins: {
        top: parsed.top!,
        bottom: parsed.bottom!,
        left: parsed.left!,
        right: parsed.right!,
      },
    });
    onOpenChange(false);
    editor.focus();
  };

  const selectValue =
    PAPER_OPTIONS.find(
      (p) =>
        p.width === paperSize.width &&
        p.height === paperSize.height,
    )?.name ?? CUSTOM;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Page setup</DialogTitle>
            <DialogDescription>
              Applies to the whole document. Margins are in inches.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="page-setup-paper">Paper size</Label>
              <Select
                value={selectValue}
                onValueChange={(name) => {
                  const next = PAPER_OPTIONS.find((p) => p.name === name);
                  if (next) setPaperSize(next);
                }}
              >
                <SelectTrigger id="page-setup-paper" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPER_OPTIONS.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                  {/* Reachable only implicitly — an imported document can
                      carry a paper size that matches no preset, and silently
                      relabelling it "Letter" would be a lie. Picking it is a
                      no-op; pick a real preset to leave custom behind. */}
                  {selectValue === CUSTOM && (
                    <SelectItem value={CUSTOM}>
                      {`Custom (${paperSize.name})`}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Orientation</legend>
              <RadioGroup
                className="flex items-center gap-6"
                value={orientation}
                onValueChange={(v) =>
                  setOrientation(v as PageSetup["orientation"])
                }
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="portrait" id="page-setup-portrait" />
                  <Label htmlFor="page-setup-portrait" className="font-normal">
                    Portrait
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="landscape" id="page-setup-landscape" />
                  <Label htmlFor="page-setup-landscape" className="font-normal">
                    Landscape
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Margins (inches)</legend>
              <div className="grid grid-cols-2 gap-3">
                {MARGIN_FIELDS.map(({ key, label }) => (
                  <div key={key} className="grid gap-1.5">
                    <Label
                      htmlFor={`page-setup-margin-${key}`}
                      className="text-xs font-normal text-muted-foreground"
                    >
                      {label}
                    </Label>
                    <Input
                      id={`page-setup-margin-${key}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.05}
                      value={margins[key]}
                      onChange={(e) =>
                        setMargins((m) => ({ ...m, [key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!editor || error !== null}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
