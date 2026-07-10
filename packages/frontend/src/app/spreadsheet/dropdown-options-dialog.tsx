import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type DropdownInvalidBehavior = "reject" | "warning";

interface DropdownOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing options when editing a rule; empty for a fresh insert. */
  initialOptions: string[];
  initialOnInvalid: DropdownInvalidBehavior;
  /** True when the active cell already carries a list rule. */
  isEditing: boolean;
  onSave: (options: string[], onInvalid: DropdownInvalidBehavior) => void;
  onRemove: () => void;
}

/**
 * `DropdownOptionsDialog` collects the literal option values (one per line) and
 * the invalid-input behavior for an in-cell dropdown (list data-validation).
 * A minimal stand-in for the full `Data → Data validation` side panel.
 */
export function DropdownOptionsDialog({
  open,
  onOpenChange,
  initialOptions,
  initialOnInvalid,
  isEditing,
  onSave,
  onRemove,
}: DropdownOptionsDialogProps) {
  const [text, setText] = useState("");
  const [onInvalid, setOnInvalid] =
    useState<DropdownInvalidBehavior>(initialOnInvalid);

  // Re-seed the fields whenever the dialog (re)opens for a new target.
  useEffect(() => {
    if (open) {
      setText(initialOptions.join("\n"));
      setOnInvalid(initialOnInvalid);
    }
  }, [open, initialOptions, initialOnInvalid]);

  const options = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const handleSave = () => {
    if (options.length === 0) return;
    onSave(options, onInvalid);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit dropdown" : "Insert dropdown"}</DialogTitle>
          <DialogDescription>
            Enter each option on its own line. Cells show a picker restricted to
            these values.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dropdown-options">Options</Label>
            <textarea
              id="dropdown-options"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              autoFocus
              placeholder={"Red\nGreen\nBlue"}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <Label>If the data is invalid</Label>
            <RadioGroup
              value={onInvalid}
              onValueChange={(v) => setOnInvalid(v as DropdownInvalidBehavior)}
              className="flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="warning" id="dropdown-warning" />
                <Label htmlFor="dropdown-warning" className="font-normal">
                  Show a warning
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="reject" id="dropdown-reject" />
                <Label htmlFor="dropdown-reject" className="font-normal">
                  Reject the input
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {isEditing ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                onRemove();
                onOpenChange(false);
              }}
            >
              Remove dropdown
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={options.length === 0}>
              {isEditing ? "Save" : "Insert"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
