import { useNavigate, useParams } from "react-router-dom";
import { TemplateGallery } from "@/app/templates/template-gallery";

/**
 * The workspace Templates tab — the Brand Templates / Google org-gallery tier
 * (docs/design/template-gallery.md, Phase 2).
 *
 * A card opens `/t/:id` rather than creating a document straight away: that
 * page already owns preview, attribution and the workspace picker, and it is
 * the single place the "use" flow lives whether the visitor arrived from a
 * hand-sent link or from this gallery.
 */
export default function WorkspaceTemplates() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold">Templates</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Documents published as templates in this workspace. Using one gives
          you your own copy — the original is never changed.
        </p>
      </div>
      <TemplateGallery
        scope="workspace"
        workspaceId={workspaceId}
        selectLabel="Open"
        onSelect={(card) => navigate(`/t/${card.id}`)}
        emptyHint="Open a document, choose Share, and publish it as a template with Workspace visibility."
      />
    </div>
  );
}
