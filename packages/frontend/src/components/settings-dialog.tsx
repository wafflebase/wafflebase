import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsContent } from "@/app/settings/page";

/**
 * This device's settings, over whatever the user was looking at.
 *
 * A dialog rather than a route because these settings are most wanted from
 * inside an editor — the sync chip's offer to start saving on this device is
 * one of the two ways people arrive at the offline switch — and leaving an
 * editor that holds unsent edits is precisely what `useNavigationGuard` stops
 * with a confirmation. A route would put that dialog between a user and the
 * setting meant to protect their work.
 *
 * Controlled from outside rather than wrapping its own trigger: it is opened
 * from a `DropdownMenuItem`, and a menu closing steals focus as it unmounts,
 * which closes a dialog whose open state lives inside it.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          {/* Names the scope in the one place it is cheap to: these apply to
              the browser in front of you, not to the account, and the offline
              section below is the one that makes that distinction matter. */}
          <DialogDescription>
            These apply to this device only.
          </DialogDescription>
        </DialogHeader>
        <SettingsContent />
      </DialogContent>
    </Dialog>
  );
}
