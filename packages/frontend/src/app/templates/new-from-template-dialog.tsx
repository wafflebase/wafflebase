import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateGallery } from "@/app/templates/template-gallery";
import { createFromTemplate } from "@/api/templates";
import { isAuthExpiredError } from "@/api/auth";
import { getDocumentPath } from "@/app/documents/document-list-utils";
import type { DocumentType } from "@/types/documents";

/**
 * "New from template" — the picker behind the documents list's create menu
 * (docs/design/template-gallery.md, Phase 2).
 *
 * Unlike the workspace Templates tab, selecting here **creates immediately**:
 * the destination is unambiguous (the workspace and folder the user is looking
 * at), which is the whole reason to offer the picker from the create menu
 * rather than sending them to `/t/:id` to choose one.
 */
export function NewFromTemplateDialog({
  open,
  onOpenChange,
  workspaceId,
  folderId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** The folder currently being viewed; omitted means the workspace root. */
  folderId?: string;
  onCreated?: () => void;
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const useTemplate = (card: { id: string }) => {
    if (creating) return;
    setCreating(true);
    createFromTemplate(card.id, workspaceId, folderId)
      .then((doc) => {
        onOpenChange(false);
        onCreated?.();
        toast.success("Document created from template");
        navigate(
          getDocumentPath({ id: doc.id, type: doc.type as DocumentType }),
        );
      })
      .catch((error) => {
        if (isAuthExpiredError(error)) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to create a document from this template",
        );
      })
      .finally(() => setCreating(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New from template</DialogTitle>
          <DialogDescription>
            Start a document from a template. You get your own copy, here in
            this workspace.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="workspace">
          <TabsList>
            <TabsTrigger value="workspace">This workspace</TabsTrigger>
            <TabsTrigger value="public">Public gallery</TabsTrigger>
          </TabsList>
          {/* Both panes create into the *same* destination — the workspace and
              folder being viewed — so the tab changes where the template comes
              from and nothing about where the document lands. */}
          <TabsContent value="workspace" className="mt-4">
            <TemplateGallery
              scope="workspace"
              workspaceId={workspaceId}
              selectLabel={creating ? "Creating..." : "Use"}
              emptyHint="Publish a document as a template from its Share dialog to see it here."
              onSelect={useTemplate}
            />
          </TabsContent>
          <TabsContent value="public" className="mt-4">
            <TemplateGallery
              scope="public"
              selectLabel={creating ? "Creating..." : "Use"}
              emptyHint="No templates have been published to the public gallery yet."
              onSelect={useTemplate}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
