import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { VALID_IMAGE_ID_PATTERN } from '../image/image.constants';

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
const MAX_TAGS = 10;

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

  @IsOptional()
  @IsString()
  @Length(1, 60)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
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

export class UseTemplateDto {
  /** Destination workspace. The caller must be a member of it. */
  @IsUUID()
  workspaceId: string;

  /** Omitted = the destination workspace's root, never the source's folder. */
  @IsOptional()
  @IsUUID()
  folderId?: string;
}
