import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { VALID_FILE_ID_PATTERN } from '../file/file.constants';

const DOCUMENT_TYPES = ['sheet', 'doc', 'slides', 'pdf', 'note', 'image'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export class CreateDocumentDto {
  @IsString()
  @Length(1, 200)
  title: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  type?: DocumentType;

  @IsOptional()
  @IsString()
  @Matches(VALID_FILE_ID_PATTERN)
  fileId?: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;
}

export class CreateDocumentInWorkspaceDto {
  @IsString()
  @Length(1, 200)
  title: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  type?: DocumentType;

  @IsOptional()
  @IsString()
  @Matches(VALID_FILE_ID_PATTERN)
  fileId?: string;

  @IsUUID()
  workspaceId: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  // `undefined` = leave unchanged; explicit `null` = move to workspace root.
  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}
