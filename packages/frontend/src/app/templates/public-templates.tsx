import { useNavigate } from "react-router-dom";
import { MarketingPage } from "@/app/home/marketing-page";
import { SectionHead } from "@/app/home/primitives/section-head";
import { RulerBackdrop } from "@/app/home/primitives/ruler-backdrop";
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

  return (
    // The nav's signed-out CTA carries `returnTo` so a visitor who signs in
    // from the gallery comes back to the gallery rather than being dropped at
    // a workspace root — the same thing `/t/:id` does. It is also the page's
    // only CTA now: the header used to carry a second one beside the nav's.
    <MarketingPage
      signInTo={`/login?returnTo=${encodeURIComponent("/templates")}`}
    >
      <section className="relative px-6 pt-14 pb-16 md:px-8 md:pt-20 md:pb-20">
        <RulerBackdrop />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <SectionHead
            kicker="Template gallery"
            title="Start from something someone already built."
            sub="Documents people have published for anyone to start from. Using one gives you your own copy — the original is never changed."
          />

          <TemplateGallery
            scope="public"
            skin="marketing"
            selectLabel="View"
            onSelect={(card) => navigate(`/t/${card.id}`)}
            emptyHint="No templates have been published to the public gallery yet."
          />
        </div>
      </section>
    </MarketingPage>
  );
}

export default PublicTemplates;
