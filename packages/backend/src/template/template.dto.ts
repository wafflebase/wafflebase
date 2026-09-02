import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { VALID_IMAGE_ID_PATTERN } from '../image/image.constants';
import {
  MAX_TEMPLATE_TAGS,
  MAX_TEMPLATE_TAG_LENGTH,
  TEMPLATE_CATEGORIES,
} from './template-taxonomy';
import {
  REPORT_REASONS,
  ReportReason,
  REVIEW_DECISIONS,
  ReviewDecision,
} from './template-review';

/**
 * A listing's audience — see docs/design/template-gallery.md.
 *
 * `public` is accepted by the model but is never reachable from this DTO: the
 * publish and update routes refuse a *transition into* it, and the only writer
 * is the approval arm of `POST /templates/:id/review`. Sending it here is a
 * `400`, which is what keeps "listing content that nothing reviews" — the one
 * failure mode a template gallery cannot walk back — off the request path
 * entirely rather than defended per handler.
 */
export const TEMPLATE_VISIBILITIES = [
  'unlisted',
  'workspace',
  'public',
] as const;
export type TemplateVisibility = (typeof TEMPLATE_VISIBILITIES)[number];

/** Matches the rename DTO's limit, so a listing title is always editable. */
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
/** Fits the notification `preview` column's 200-char budget with room to spare. */
const MAX_REVIEW_NOTE = 500;

export class PublishTemplateDto {
  /** Defaults to the document's own title. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_TITLE)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, MAX_DESCRIPTION)
  description?: string;

  /**
   * One of the closed `TEMPLATE_CATEGORIES`. Closed rather than freeform so
   * the gallery's category facet means something — see template-taxonomy.ts.
   */
  @IsOptional()
  @IsIn(TEMPLATE_CATEGORIES)
  category?: string;

  /**
   * Freeform, but normalized on write (`normalizeTags`) — the service is what
   * lowercases and de-duplicates. Validation here only bounds the input.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEMPLATE_TAGS)
  @IsString({ each: true })
  @Length(1, MAX_TEMPLATE_TAG_LENGTH, { each: true })
  tags?: string[];

  /**
   * A key in the image bucket. Validated against the image id pattern for the
   * same reason `GET /images/:id` does: it is the only thing standing between
   * this column and an arbitrary storage key.
   */
  @IsOptional()
  @IsString()
  @Matches(VALID_IMAGE_ID_PATTERN)
  thumbnailId?: string;

  @IsOptional()
  @IsIn(TEMPLATE_VISIBILITIES)
  visibility?: TemplateVisibility;

  /**
   * The publisher's grant that others may copy and modify the content. Only
   * meaningful for the `public` tier, which cannot be published without it.
   */
  @IsOptional()
  @IsBoolean()
  acceptLicense?: boolean;
}

export class UpdateTemplateDto extends PublishTemplateDto {}

/**
 * Which audience the caller is browsing. There is deliberately **no
 * `unlisted`** scope: holding a listing's id is that tier's entire access
 * story, so a collection that returned unlisted rows would hand out that
 * capability wholesale.
 */
export const TEMPLATE_SCOPES = ['workspace', 'public'] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const TEMPLATE_SORTS = ['popular', 'recent'] as const;
export type TemplateSort = (typeof TEMPLATE_SORTS)[number];

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

export class BrowseTemplatesDto {
  @IsIn(TEMPLATE_SCOPES)
  scope: TemplateScope;

  /**
   * Required for `scope=workspace`; the caller must be a member of it.
   *
   * A workspace **id or slug**, not a UUID. Every workspace-scoped URL in the
   * app is `/w/:workspaceId` carrying the *slug*
   * (`/w/hackerwins-s-workspace/templates`), and the pages read it straight
   * off `useParams`. `WorkspaceService.assertMember` resolves either through
   * `resolveId`, so requiring a UUID here rejected the only value the gallery
   * ever actually sends.
   */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  workspaceId?: string;

  /** Document type facet — `sheet`, `doc`, `slides`, … */
  @IsOptional()
  @IsString()
  @Length(1, 20)
  type?: string;

  @IsOptional()
  @IsIn(TEMPLATE_CATEGORIES)
  category?: string;

  /**
   * A single tag; normalized before matching, with array containment.
   *
   * `@Matches` as well as `@Length`: a whitespace-only value passes a length
   * check but normalizes to *nothing*, and a filter that reduces to nothing
   * would be dropped from the `where` clause — so `?tag=%20%20` would silently
   * return the whole unfiltered gallery instead of the empty result the caller
   * asked for. Refused here rather than repaired downstream.
   */
  @IsOptional()
  @IsString()
  @Length(1, MAX_TEMPLATE_TAG_LENGTH)
  @Matches(/\S/, { message: 'tag must contain a non-whitespace character' })
  tag?: string;

  /**
   * Free text over title and description, and — when the whole query
   * normalizes to one tag-shaped token — over tags by containment.
   */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @IsIn(TEMPLATE_SORTS)
  sort?: TemplateSort;

  /**
   * The id of the last row of the previous page. Keyset, not offset: a gallery
   * ranked by a counter that changes under you would skip and repeat rows
   * under offset paging.
   */
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;
}

/**
 * Ask for the public tier. Deliberately its own verb rather than
 * `PATCH /templates/:id { visibility: 'public' }`: `visibility` is the
 * *effective* tier and is written to `public` only by an approval, so there is
 * no request body a publisher can send that reaches it.
 */
export class SubmitTemplateDto {
  /**
   * The grant that others may copy and modify the content. Required, and
   * required to be `true` — a submission without it would have us
   * redistributing someone's document on an assumption.
   */
  @IsBoolean()
  acceptLicense: boolean;
}

export class ReviewTemplateDto {
  @IsIn(REVIEW_DECISIONS)
  decision: ReviewDecision;

  /**
   * The reviewer's reason, which becomes the body of the publisher's
   * notification and is stored on the listing.
   *
   * **Required for `reject` and `takedown`**, optional on an approval where
   * there is nothing to explain. A refusal with no reason is the failure mode
   * this whole pipeline exists to avoid — the publisher is left with a listing
   * they can no longer edit or republish and nothing telling them why.
   */
  @ValidateIf((dto: ReviewTemplateDto) => dto.decision !== 'approve')
  @IsString()
  @Length(1, MAX_REVIEW_NOTE)
  note?: string;

  /**
   * The content watermark the reviewer's queue row carried, echoed back.
   *
   * Load-bearing for `approve`: the service compares it to the listing's
   * current `contentChangedAt` and answers `409` on any difference — including
   * the difference between "never edited" (null) and "edited once". Omitted for
   * a listing that has never been edited, which is the common case.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  contentAt?: string;
}

export class ReportTemplateDto {
  @IsIn(REPORT_REASONS)
  reason: ReportReason;

  /** Optional detail — a link to the original, what is broken, and so on. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_REVIEW_NOTE)
  note?: string;
}

export class ResolveReportDto {
  @IsIn(['dismissed', 'actioned'])
  outcome: 'dismissed' | 'actioned';
}

export class UseTemplateDto {
  /**
   * Destination workspace — an id **or slug**, for the same reason
   * `BrowseTemplatesDto.workspaceId` is. The New-from-template picker is
   * mounted from the documents list, whose `workspaceId` prop is the slug out
   * of `/w/:workspaceId`; the landing page's picker sends a real id. Both
   * resolve through `assertMember`, and the *resolved* id is what the copy
   * lands in.
   */
  @IsString()
  @Length(1, 200)
  workspaceId: string;

  /** Omitted = the destination workspace's root, never the source's folder. */
  @IsOptional()
  @IsUUID()
  folderId?: string;
}
