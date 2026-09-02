import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { TemplateGallery } from "@/app/templates/template-gallery";

/**
 * `/templates` — the public template gallery
 * (docs/design/template-gallery.md, Phase 3c).
 *
 * Outside `PrivateRoute`, like `/t/:id` and for the same reason: the whole
 * point of a public gallery is that someone who has never signed in can look
 * through it. Choosing a template opens its landing page, and only *using* one
 * needs an account — the split Canva and CapCut both make, and the one this
 * feature already implements at `/t/:id`.
 *
 * Almost nothing here is new. `TemplateGallery` already carries the facets,
 * the sort, the search box, keyset paging and the card; this page is the
 * unauthenticated route around it plus a header that makes sense to a
 * stranger.
 *
 * Not indexable: the frontend is a Vite SPA with no server rendering, so a
 * crawler sees an empty shell. Making the gallery discoverable through search
 * engines is a prerendering project and is deliberately not faked here.
 */
export function PublicTemplates() {
  const navigate = useNavigate();

  // Optional: the page renders either way. It only decides which button the
  // header offers, so a failure is not worth surfacing.
  const me = useQuery({
    queryKey: ["me-optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/"
            className="text-muted-foreground text-sm no-underline hover:underline"
          >
            ← Wafflebase
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Templates</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Documents people have published for anyone to start from. Using one
            gives you your own copy — the original is never changed.
          </p>
        </div>
        {/* Real links, not buttons with an onClick: these navigate, so
            middle-click and open-in-new-tab have to work and assistive tech
            has to hear a link. Signing in carries `returnTo` so a visitor
            comes back to the gallery rather than being dropped at a workspace
            root — the same thing `/t/:id` does. */}
        <Button asChild variant={me.data ? "outline" : "default"}>
          {me.data ? (
            <Link to="/documents">My documents</Link>
          ) : (
            <Link to={`/login?returnTo=${encodeURIComponent("/templates")}`}>
              Sign in
            </Link>
          )}
        </Button>
      </header>

      <TemplateGallery
        scope="public"
        selectLabel="View"
        onSelect={(card) => navigate(`/t/${card.id}`)}
        emptyHint="No templates have been published to the public gallery yet."
      />
    </main>
  );
}

export default PublicTemplates;
