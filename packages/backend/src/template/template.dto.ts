import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { VALID_IMAGE_ID_PATTERN } from '../image/image.constants';
import {
  MAX_TEMPLATE_TAGS,
  MAX_TEMPLATE_TAG_LENGTH,
  TEMPLATE_CATEGORIES,
} from './template-taxonomy';

/**
 * A listing's audience — see docs/design/template-gallery.md.
 *
 * `public` is accepted by the model but refused by the service until the
 * Phase 3 review pipeline exists: listing content that nothing reviews is the
 * one failure mode a template gallery cannot walk back.
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

  /** Required for `scope=workspace`; the caller must be a member of it. */
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  /** Document type facet — `sheet`, `doc`, `slides`, … */
  @IsOptional()
  @IsString()
  @Length(1, 20)
  type?: string;

  @IsOptional()
  @IsIn(TEMPLATE_CATEGORIES)
  category?: string;

  /** A single normalized tag; matched with array containment. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_TEMPLATE_TAG_LENGTH)
  tag?: string;

  /** Free-text over title and description. */
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

export class UseTemplateDto {
  /** Destination workspace. The caller must be a member of it. */
  @IsUUID()
  workspaceId: string;

  /** Omitted = the destination workspace's root, never the source's folder. */
  @IsOptional()
  @IsUUID()
  folderId?: string;
}
