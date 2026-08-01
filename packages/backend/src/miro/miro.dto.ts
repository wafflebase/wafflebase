import { IsNotEmpty, IsString } from 'class-validator';

export class ImportMiroBoardDto {
  /**
   * The user's Miro access token. Used for this request only — never stored,
   * never logged, never returned.
   */
  @IsString()
  @IsNotEmpty()
  token!: string;

  /** A Miro board URL, or a bare board id. */
  @IsString()
  @IsNotEmpty()
  boardUrl!: string;
}
