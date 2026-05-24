import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const DOCUMENT_TYPES = ['sheet', 'doc', 'slides'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export class CreateDocumentDto {
  @IsString()
  @Length(1, 200)
  title: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  type?: DocumentType;
}

export class CreateDocumentInWorkspaceDto {
  @IsString()
  @Length(1, 200)
  title: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  type?: DocumentType;

  @IsUUID()
  workspaceId: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}
