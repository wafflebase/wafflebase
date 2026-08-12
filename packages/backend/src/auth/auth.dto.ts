import { IsOptional, IsString, Length } from 'class-validator';

export class CliExchangeDto {
  @IsString()
  @Length(1, 200)
  code: string;

  /**
   * PKCE verifier (RFC 7636 §4.1: 43–128 characters). Required when the
   * login that minted the code carried a `code_challenge`; omitted by CLIs
   * that predate PKCE.
   */
  @IsOptional()
  @IsString()
  @Length(43, 128)
  codeVerifier?: string;
}
