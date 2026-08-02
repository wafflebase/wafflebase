import { useEffect, useState, type FormEvent } from "react";
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
import { isAuthExpiredError } from "@/api/auth";
import { startMiroImport } from "./miro-import-runner";

interface MiroImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
  folderId?: string | null;
}

/**
 * Import a Miro board into a new board document.
 *
 * The token is held for the single request and never persisted — the copy in
 * the dialog says so, because asking for a credential without saying what
 * happens to it is not acceptable.
 *
 * ## What this component is and is not responsible for
 *
 * It owns the form and the errors the form can fix, and nothing else. Submit
 * awaits only the part of the import that can still fail with a status the
 * user can act on from right here — a rejected token, a board they cannot
 * read, a board that does not exist. Once the request is underway the dialog
 * closes and `startMiroImport` reports the remaining 30-60s into the upload
 * panel, exactly like a PPTX/XLSX import, so the user can navigate away while
 * it finishes. Nothing about the running import is anchored to this component:
 * unmounting it must not cancel anything.
 */
export function MiroImportDialog({
  open,
  onOpenChange,
  workspaceId,
  folderId,
}: MiroImportDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on OPEN rather than on close: it covers every way the dialog can go
  // away (Cancel, Esc, the overlay, a successful import) in one place, so a
  // failed attempt cannot greet the user again the next time they open it.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;

    const form = new FormData(e.target as HTMLFormElement);
    const token = String(form.get("token") ?? "").trim();
    const boardUrl = String(form.get("boardUrl") ?? "").trim();
    if (!token || !boardUrl) return;

    setError(null);
    setBusy(true);
    try {
      // Resolves once the server has committed to a 200 — i.e. the import is
      // genuinely running. The token goes no further than this call.
      await startMiroImport({ workspaceId, folderId, token, boardUrl });
      // Close immediately: the panel has the readout from here on, and the
      // import does not depend on this component staying mounted.
      onOpenChange(false);
    } catch (err) {
      // An expired session is already redirecting to login; an inline "failed
      // to import" on the way out is noise about the wrong problem.
      if (isAuthExpiredError(err)) return;
      // Keep the dialog open so the pasted values aren't lost.
      setError(
        err instanceof Error ? err.message : "Failed to import the Miro board",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Import from Miro</DialogTitle>
            <DialogDescription>
              Paste a Miro access token and the board URL. The token is used for
              this import only — it is never stored. Once the import starts it
              continues in the background, and its progress is shown in the
              uploads panel.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="miro-token">Access token</Label>
              {/*
                `autoComplete="off"`: a bare type="password" field makes the
                browser offer to SAVE this credential, which contradicts the
                promise directly above it that the token is never stored.
              */}
              <Input
                id="miro-token"
                name="token"
                type="password"
                autoComplete="off"
                autoFocus
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="miro-board-url">Board URL</Label>
              <Input
                id="miro-board-url"
                name="boardUrl"
                placeholder="https://miro.com/app/board/uXjVOD50NUI=/"
                required
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            {/*
              The label only spans "Import" -> "Starting…" now: the long tail of
              the import is reported in the panel, so this button is no longer
              a progress readout and no longer needs a fixed width to stop it
              resizing on every tick.
            */}
            <Button type="submit" disabled={busy || !workspaceId}>
              {busy ? "Starting…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default MiroImportDialog;
