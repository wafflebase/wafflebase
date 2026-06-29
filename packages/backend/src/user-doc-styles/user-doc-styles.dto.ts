import { IsObject } from 'class-validator';

export class UpdateUserDocStylesDto {
  @IsObject()
  styles: Record<string, unknown>;
}
