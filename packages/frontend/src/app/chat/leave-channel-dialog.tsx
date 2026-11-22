import type { ChannelSummary } from "@/api/chat";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LeaveChannelDialogProps {
  /** The private channel being left; null keeps the dialog closed. */
  channel: ChannelSummary | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before leaving a private channel. A public channel is left at once
 * with an Undo toast, since anyone can rejoin it; a private one cannot be
 * found again without somebody inside adding you back, so a slip here is
 * not undoable from your side.
 */
export function LeaveChannelDialog({
  channel,
  pending,
  onConfirm,
  onCancel,
}: LeaveChannelDialogProps) {
  const name = channel?.name ?? "";
  return (
    <Dialog open={channel !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave #{name}?</DialogTitle>
          <DialogDescription>
            {`You'll need an invite from a member to rejoin #${name}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Leave channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
