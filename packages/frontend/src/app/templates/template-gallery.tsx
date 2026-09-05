import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  browseTemplates,
  TEMPLATE_CATEGORIES,
  type TemplateBrowsePage,
  type TemplateCard,
} from "@/api/templates";
import { isAuthExpiredError } from "@/api/auth";
import { imageUrl } from "@/api/images";
import { typeMeta, TYPE_OPTIONS } from "@/app/documents/document-type-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WbButton } from "@/app/home/primitives/wb-button";
import { cn } from "@/lib/utils";

/** `Select` has no empty-string value, so "no facet" needs a sentinel. */
const ANY = "__any__";

/**
 * Which visual language the grid speaks.
 *
 * `"app"` is the product's own chrome — shadcn tokens, square cards — and is
 * the default because two of the three mounts (the workspace Templates tab and
 * the New-from-template dialog) are *inside* the app, where marketing styling
 * would be a foreign object.
 *
 * `"marketing"` is the landing page's `--wb-*` skin, used by the public
 * gallery at `/templates`, which sits in front of the product beside `/`.
 *
 * The split is presentation only: the query, the facets, keyset paging and the
 * `onSelect` contract stay one implementation under both.
 */
export type GallerySkin = "app" | "marketing";

/** The paper-card lift shared with the landing page's use-case cards. */
const PAPER_SHADOW =
  "0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)";

/**
 * The template gallery grid — the one browsing surface behind the workspace
 * Templates tab, the New-from-template picker, and (Phase 3) the public
 * gallery. See docs/design/template-gallery.md.
 *
 * Cards carry **no preview token** — the collection endpoint does not return
 * one. Opening a card is what fetches it, which is why `onSelect` hands back
 * the card rather than anything capability-bearing.
 */
export function TemplateGallery({
  scope,
  workspaceId,
  onSelect,
  selectLabel,
  emptyHint,
  skin = "app",
}: {
  scope: "workspace" | "public";
  workspaceId?: string;
  onSelect: (card: TemplateCard) => void;
  selectLabel: string;
  emptyHint?: string;
  skin?: GallerySkin;
}) {
  const marketing = skin === "marketing";
  const [type, setType] = useState(ANY);
  const [category, setCategory] = useState(ANY);
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");

  const query = useInfiniteQuery<TemplateBrowsePage>({
    queryKey: [
      "templates",
      scope,
      workspaceId,
      type,
      category,
      sort,
      submittedQ,
    ],
    queryFn: ({ pageParam }) =>
      browseTemplates({
        scope,
        workspaceId,
        ...(type !== ANY ? { type } : {}),
        ...(category !== ANY ? { category } : {}),
        sort,
        ...(submittedQ ? { q: submittedQ } : {}),
        ...(pageParam ? { cursor: pageParam as string } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: scope === "public" || !!workspaceId,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  // The shadcn `Input`/`Select` primitives stay under both skins — rewriting
  // Radix's Select internals for the sake of a border would be out of all
  // proportion to the difference it makes. They just borrow the paper surface.
  const field = marketing
    ? "border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] text-[color:var(--wb-ink)]"
    : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQ(q.trim());
          }}
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search templates"
            className={cn("w-56", field)}
            aria-label="Search templates"
          />
          {marketing ? (
            <WbButton type="submit" variant="ghost">
              Search
            </WbButton>
          ) : (
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
          )}
        </form>

        <Select value={type} onValueChange={setType}>
          <SelectTrigger className={cn("w-36", field)} aria-label="Document type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All types</SelectItem>
            {TYPE_OPTIONS.map((t) => (
              <SelectItem key={t} value={t}>
                {typeMeta(t).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className={cn("w-44", field)} aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All categories</SelectItem>
            {TEMPLATE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sort}
          onValueChange={(v) => setSort(v as "popular" | "recent")}
        >
          <SelectTrigger className={cn("w-36", field)} aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Most used</SelectItem>
            <SelectItem value="recent">Newest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <div
          className={cn(
            "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
            marketing ? "gap-5 md:gap-6" : "gap-4",
          )}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton
              key={i}
              className={cn(
                "w-full",
                // Matched to the marketing card, which leads with a fixed
                // 16:10 picture box — a 40-unit block would collapse the grid
                // to a different shape the moment the data lands.
                marketing ? "h-64 rounded-2xl" : "h-40 rounded-md",
              )}
            />
          ))}
        </div>
      ) : query.isError ? (
        isAuthExpiredError(query.error) ? null : (
          <p className="text-destructive text-sm">
            Failed to load templates. Please try again.
          </p>
        )
      ) : items.length === 0 ? (
        <div
          className={cn(
            "border border-dashed p-10 text-center",
            marketing
              ? "rounded-2xl border-[color:var(--wb-rule)]"
              : "rounded-md",
          )}
        >
          <p
            className={cn(
              "font-medium",
              marketing &&
                "font-display text-[19px] text-[color:var(--wb-ink)]",
            )}
          >
            No templates yet
          </p>
          <p
            className={cn(
              "mt-1 text-sm",
              marketing
                ? "text-[color:var(--wb-sub)]"
                : "text-muted-foreground",
            )}
          >
            {emptyHint ??
              "Publish a document as a template from its Share dialog."}
          </p>
        </div>
      ) : (
        <>
          <div
            className={cn(
              "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
              marketing ? "gap-5 md:gap-6" : "gap-4",
            )}
          >
            {items.map((card) =>
              marketing ? (
                <MarketingGalleryCard
                  key={card.id}
                  card={card}
                  selectLabel={selectLabel}
                  onSelect={onSelect}
                />
              ) : (
                <TemplateGalleryCard
                  key={card.id}
                  card={card}
                  selectLabel={selectLabel}
                  onSelect={onSelect}
                />
              ),
            )}
          </div>
          {query.hasNextPage && (
            <div className="flex justify-center pt-2">
              {marketing ? (
                <WbButton
                  variant="ghost"
                  size="lg"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </WbButton>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The same card in the landing page's skin, for the public gallery.
 *
 * Three deliberate differences from the app card, all of them about being a
 * *gallery* rather than a list:
 *
 * 1. The whole card is the button. A grid of pictures where only a small
 *    corner control is clickable reads as a list of rows; the visible `View`
 *    pill is a `<span>` that appears on hover, not a nested button, because
 *    an interactive element inside a button is neither valid nor operable.
 * 2. The picture box is always there. A listing with no thumbnail is an
 *    ordinary case — `note`, `pdf` and `file` have no capture path at all —
 *    and letting those cards be shorter turns the grid ragged. The
 *    document-type icon fills the box instead.
 * 3. `object-contain` on a butter wash, not `object-cover`: thumbnails arrive
 *    in whatever shape their document is, and cropping a 16:9 deck to fill a
 *    box cuts the sides off the thing you are choosing.
 */
function MarketingGalleryCard({
  card,
  selectLabel,
  onSelect,
}: {
  card: TemplateCard;
  selectLabel: string;
  onSelect: (card: TemplateCard) => void;
}) {
  const { Icon, color, label } = typeMeta(card.documentType);
  const [thumbnailBroken, setThumbnailBroken] = useState(false);
  const thumbnail =
    card.thumbnailId && !thumbnailBroken ? card.thumbnailId : null;

  return (
    <button
      type="button"
      // Named, because a grid of 24 cards otherwise gives a screen-reader user
      // 24 buttons all called "View".
      aria-label={`${selectLabel} ${card.title}`}
      onClick={() => onSelect(card)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] text-left outline-none transition-all duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[color:var(--wb-syrup)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--wb-bg)]"
      style={{ boxShadow: PAPER_SHADOW }}
    >
      <div
        className="relative aspect-[16/10] w-full overflow-hidden border-b border-[color:var(--wb-rule)]"
        style={{
          background: "color-mix(in srgb, var(--wb-butter) 22%, transparent)",
        }}
      >
        {thumbnail ? (
          <img
            src={imageUrl(thumbnail)}
            alt=""
            loading="lazy"
            // An id outlives the object it names — the bucket can be swept, or
            // a listing can carry an id from before capture worked. Falling
            // back to the icon beats a broken-image glyph on the card.
            onError={() => setThumbnailBroken(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon className={`h-12 w-12 stroke-1 ${color}`} />
          </div>
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 bottom-3 rounded-full border border-[color:var(--wb-syrup-deep)] bg-[color:var(--wb-syrup)] px-3 py-1 font-code text-[11.5px] tracking-[0.04em] text-[#FFFAF0] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {selectLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-5 pt-4 pb-5">
        <h3
          className="m-0 truncate font-display text-[17px] font-semibold tracking-[-0.01em] text-[color:var(--wb-ink)]"
          style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
        >
          {card.title}
        </h3>
        <p className="m-0 truncate font-code text-[11.5px] tracking-[0.04em] text-[color:var(--wb-sub)]">
          {label}
          {card.author ? ` · ${card.author.username}` : ""}
          {card.useCount > 0
            ? ` · used ${card.useCount} ${card.useCount === 1 ? "time" : "times"}`
            : ""}
        </p>

        {card.description && (
          <p className="m-0 line-clamp-2 text-[13.5px] leading-[1.5] text-[color:var(--wb-sub)]">
            {card.description}
          </p>
        )}

        {(card.category || card.tags.length > 0) && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {card.category && (
              <span
                className="rounded-full px-2.5 py-1 font-code text-[11px] uppercase tracking-[0.1em] text-[color:var(--wb-syrup-deep)]"
                style={{
                  background:
                    "color-mix(in srgb, var(--wb-butter) 30%, transparent)",
                }}
              >
                {card.category}
              </span>
            )}
            {card.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[color:var(--wb-rule)] px-2.5 py-1 text-[11px] text-[color:var(--wb-sub)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * One card, led by the picture taken when the template was published
 * (docs/design/template-gallery.md).
 *
 * The document-type icon stays as the fallback rather than being replaced:
 * `note`, `pdf` and `file` have no capture path at all, and any document
 * holding a remote image cannot be captured either, so a listing with no
 * thumbnail is an ordinary case and not a broken one.
 */
function TemplateGalleryCard({
  card,
  selectLabel,
  onSelect,
}: {
  card: TemplateCard;
  selectLabel: string;
  onSelect: (card: TemplateCard) => void;
}) {
  const { Icon, color, label } = typeMeta(card.documentType);
  const [thumbnailBroken, setThumbnailBroken] = useState(false);
  return (
    <div className="flex flex-col rounded-md border p-4">
      {card.thumbnailId && !thumbnailBroken && (
        <img
          src={imageUrl(card.thumbnailId)}
          alt=""
          loading="lazy"
          // An id outlives the object it names — the bucket can be swept, or a
          // listing can carry an id from before capture worked. Falling back
          // to the icon beats a broken-image glyph on the card.
          onError={() => setThumbnailBroken(true)}
          // Letterboxed, not cropped. Thumbnails arrive in whatever shape
          // their document is — a deck is 16:9, a docs or sheet capture is
          // the editor viewport — and `object-cover` in a fixed box cut the
          // sides off every slide. The box stays one size so the grid stays a
          // grid; `contain` keeps the whole picture inside it, which is the
          // point of a gallery where the picture is what you are choosing.
          className="bg-muted mb-3 aspect-[16/10] w-full rounded border object-contain"
        />
      )}
      <div className="flex items-start gap-3">
        <Icon className={`h-8 w-8 shrink-0 stroke-1 ${color}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{card.title}</p>
          <p className="text-muted-foreground truncate text-xs">
            {label}
            {card.author ? ` · ${card.author.username}` : ""}
            {card.useCount > 0
              ? ` · used ${card.useCount} ${card.useCount === 1 ? "time" : "times"}`
              : ""}
          </p>
        </div>
      </div>

      {card.description && (
        <p className="text-muted-foreground mt-3 line-clamp-2 text-sm">
          {card.description}
        </p>
      )}

      {(card.category || card.tags.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1">
          {card.category && (
            <span className="bg-muted rounded px-2 py-0.5 text-xs">
              {card.category}
            </span>
          )}
          {card.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-muted-foreground rounded border px-2 py-0.5 text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          variant="outline"
          // Named, because a grid of 24 cards otherwise gives a screen-reader
          // user 24 buttons all called "Use".
          aria-label={`${selectLabel} ${card.title}`}
          onClick={() => onSelect(card)}
        >
          {selectLabel}
        </Button>
      </div>
    </div>
  );
}
