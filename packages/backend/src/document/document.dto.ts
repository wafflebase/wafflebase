import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { VALID_FILE_ID_PATTERN } from '../file/file.constants';

const DOCUMENT_TYPES = [
  'sheet',
  'doc',
  'slides',
  'pdf',
  'note',
  'image',
  'board',
  'file',
] as const;
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

  // Blob metadata, accepted only alongside a fileId (the controller drops it
  // otherwise). Advisory display data — never a security decision.
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  mimeType?: string;

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

  // Blob metadata, accepted only alongside a fileId (the controller drops it
  // otherwise). Advisory display data — never a security decision.
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  mimeType?: string;

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

export class MoveDocumentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids: string[];

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  // `undefined` = leave folder unchanged; explicit `null` = workspace root.
  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}

export class DeleteDocumentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids: string[];
}
