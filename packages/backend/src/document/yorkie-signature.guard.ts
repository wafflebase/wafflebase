import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Verifies Yorkie event-webhook requests. Yorkie signs the request body with
 * `HMAC-SHA256(rawBody, project.SecretKey)` and sends it as
 * `X-Signature-256: sha256=<hex>` (see yorkie `pkg/webhook/client.go`). The
 * signing key is the project's secret key, which this backend already holds
 * as `YORKIE_SECRET_KEY` for the admin service — so no new secret is needed.
 *
 * The raw request bytes are captured by the `verify` hook wired into
 * `bodyParser.json` in `main.ts`; HMAC must run over the exact bytes, not a
 * re-serialized object.
 */
@Injectable()
export class YorkieSignatureGuard implements CanActivate {
  private readonly logger = new Logger(YorkieSignatureGuard.name);
  private readonly secretKey?: string;

  constructor(configService: ConfigService) {
    this.secretKey = configService.get<string>('YORKIE_SECRET_KEY');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.secretKey) {
      // Without the shared secret we cannot authenticate the caller; refuse
      // rather than trust an unsigned request to mutate `updatedAt`.
      this.logger.error(
        'YORKIE_SECRET_KEY is not configured; rejecting event webhook',
      );
      throw new ServiceUnavailableException('Webhook verification unavailable');
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer }>();

    const header = req.header('x-signature-256');
    const rawBody = req.rawBody;
    if (!header || !rawBody) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const expected = `sha256=${createHmac('sha256', this.secretKey)
      .update(rawBody)
      .digest('hex')}`;

    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}
