import { IsString, Length, Matches } from 'class-validator';

export class CliExchangeDto {
  @IsString()
  @Length(1, 200)
  code: string;

  /**
   * The PKCE verifier for this login attempt: 43–128 base64url characters
   * whose SHA-256 was registered as the `challenge` when the login
   * started. Required — a code with no verifier is a bare bearer token
   * (see `AuthController.cliExchange`).
   */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43,128}$/, {
    message: 'verifier must be 43-128 base64url characters',
  })
  verifier: string;
}
