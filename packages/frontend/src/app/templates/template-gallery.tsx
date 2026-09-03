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

/** `Select` has no empty-string value, so "no facet" needs a sentinel. */
const ANY = "__any__";

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
}: {
  scope: "workspace" | "public";
  workspaceId?: string;
  onSelect: (card: TemplateCard) => void;
  selectLabel: string;
  emptyHint?: string;
}) {
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
            className="w-56"
            aria-label="Search templates"
          />
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>

        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-36" aria-label="Document type">
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
          <SelectTrigger className="w-44" aria-label="Category">
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
          <SelectTrigger className="w-36" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Most used</SelectItem>
            <SelectItem value="recent">Newest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-md" />
          ))}
        </div>
      ) : query.isError ? (
        isAuthExpiredError(query.error) ? null : (
          <p className="text-destructive text-sm">
            Failed to load templates. Please try again.
          </p>
        )
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center">
          <p className="font-medium">No templates yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {emptyHint ??
              "Publish a document as a template from its Share dialog."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((card) => (
              <TemplateGalleryCard
                key={card.id}
                card={card}
                selectLabel={selectLabel}
                onSelect={onSelect}
              />
            ))}
          </div>
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
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
