import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseReviewerIds } from './template-review';

/**
 * Gates the template review queue on `WAFFLEBASE_TEMPLATE_REVIEWER_IDS`.
 *
 * Stacked *after* `JwtAuthGuard`, never instead of it: this guard answers "may
 * this user review", not "who is this user". A request that reaches it with no
 * `req.user` is refused rather than treated as anonymous-and-therefore-allowed.
 *
 * An empty allowlist refuses everyone, which is the whole point — a deployment
 * that configures no reviewers has no review pipeline, and the public tier
 * stays shut rather than opening to whoever happens to be signed in.
 */
@Injectable()
export class TemplateReviewerGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number | string } }>();
    const rawId = req.user?.id;
    const userId = typeof rawId === 'string' ? Number(rawId) : rawId;
    if (typeof userId !== 'number' || !Number.isSafeInteger(userId)) {
      throw new ForbiddenException('Not a template reviewer');
    }

    const reviewers = parseReviewerIds(
      this.config.get<string>('WAFFLEBASE_TEMPLATE_REVIEWER_IDS'),
    );
    if (!reviewers.has(userId)) {
      throw new ForbiddenException('Not a template reviewer');
    }
    return true;
  }
}
