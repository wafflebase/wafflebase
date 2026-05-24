import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const WORKSPACE_ROLES = ['member', 'owner'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export class CreateWorkspaceDto {
  @IsString()
  @Length(1, 100)
  name: string;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be 1-64 chars: lowercase letters, digits, hyphens, not edge-hyphenated',
  })
  slug?: string;
}

export class CreateInviteDto {
  @IsOptional()
  @IsIn(WORKSPACE_ROLES, {
    message: `role must be one of: ${WORKSPACE_ROLES.join(', ')}`,
  })
  role?: WorkspaceRole;

  @IsOptional()
  @IsString()
  @Matches(/^\d+[hd]$/, {
    message: 'expiration must be like "12h" or "7d"',
  })
  expiration?: string;
}
