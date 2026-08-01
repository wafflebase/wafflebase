import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { mapMiroItems } from "@wafflebase/board";
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
import { importMiroBoard } from "@/api/miro";
import { createWorkspaceDocument } from "@/api/workspaces";
import { applyImportedContent } from "./apply-imported-content";
import { getDocumentPath } from "./document-list-utils";
import { summarizeImport } from "./miro-import-summary";

interface MiroImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
  folderId?: string | null;
}

type Phase = "idle" | "fetching" | "creating";

/**
 * Import a Miro board into a new board document.
 *
 * The token is held in local component state for the single request and never
 * persisted — the copy in the dialog says so, because asking for a credential
 * without saying what happens to it is not acceptable.
 */
export function MiroImportDialog({
  open,
  onOpenChange,
  workspaceId,
  folderId,
}: MiroImportDialogProps) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;

    const form = new FormData(e.target as HTMLFormElement);
    const token = String(form.get("token") ?? "").trim();
    const boardUrl = String(form.get("boardUrl") ?? "").trim();
    if (!token || !boardUrl) return;

    setError(null);
    setPhase("fetching");
    try {
      const result = await importMiroBoard(workspaceId, { token, boardUrl });
      const { inits, skipped } = mapMiroItems({
        items: result.items,
        connectors: result.connectors,
      });

      setPhase("creating");
      const doc = await createWorkspaceDocument(workspaceId, {
        title: "Imported Miro board",
        type: "board",
        folderId: folderId ?? undefined,
      });
      await applyImportedContent(doc.id, { type: "board", elements: inits });

      const summary = summarizeImport(skipped, result.notes ?? []);
      if (summary) {
        toast.warning(`Imported with notes: ${summary}`);
      } else {
        toast.success("Miro board imported");
      }

      onOpenChange(false);
      navigate(getDocumentPath(doc));
    } catch (err) {
      // Keep the dialog open so the pasted values aren't lost.
      setError(err instanceof Error ? err.message : "Failed to import the Miro board");
    } finally {
      setPhase("idle");
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
              this import only — it is never stored.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="miro-token">Access token</Label>
              <Input id="miro-token" name="token" type="password" autoFocus required />
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
            <Button type="submit" disabled={busy || !workspaceId}>
              {phase === "fetching"
                ? "Reading board…"
                : phase === "creating"
                  ? "Creating…"
                  : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default MiroImportDialog;
