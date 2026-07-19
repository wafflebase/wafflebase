import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  // `undefined` = leave parent unchanged; explicit `null` = move to workspace
  // root. `@IsOptional()` skips validation for both null and undefined, so a
  // null reaches the controller and is handled there.
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
