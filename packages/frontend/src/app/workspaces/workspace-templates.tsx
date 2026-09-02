import { useNavigate, useParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateGallery } from "@/app/templates/template-gallery";

/**
 * The workspace Templates tab — the Brand Templates / Google org-gallery tier
 * (docs/design/template-gallery.md, Phase 2), plus the public gallery beside it
 * (Phase 3c).
 *
 * Both scopes read the same collection endpoint and render the same grid; the
 * tab only changes which audience is being asked for. Putting the public one
 * here as well as at `/templates` is the Canva shape: a gallery to browse, and
 * the same templates reachable from where you are already choosing one.
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
          Using a template gives you your own copy — the original is never
          changed.
        </p>
      </div>

      <Tabs defaultValue="workspace">
        <TabsList>
          <TabsTrigger value="workspace">This workspace</TabsTrigger>
          <TabsTrigger value="public">Public gallery</TabsTrigger>
        </TabsList>

        {/* Each pane mounts its own gallery, so the filters you set on one
            audience are never silently applied to the other. Radix unmounts
            the inactive pane, so those filters are discarded rather than
            preserved — which also means the hidden pane issues no request. */}
        <TabsContent value="workspace" className="mt-4">
          <TemplateGallery
            scope="workspace"
            workspaceId={workspaceId}
            selectLabel="Open"
            onSelect={(card) => navigate(`/t/${card.id}`)}
            emptyHint="Open a document, choose Share, and publish it as a template with Workspace visibility."
          />
        </TabsContent>

        <TabsContent value="public" className="mt-4">
          <TemplateGallery
            scope="public"
            selectLabel="Open"
            onSelect={(card) => navigate(`/t/${card.id}`)}
            emptyHint="No templates have been published to the public gallery yet."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
