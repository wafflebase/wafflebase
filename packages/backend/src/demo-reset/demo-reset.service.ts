import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShareLinkService } from '../share-link/share-link.service';
import { YorkieService } from '../yorkie/yorkie.service';
import { yorkieDocKeyPrefix } from '../yorkie/yorkie-doc-key';
import {
  DemoResetConfig,
  DemoResetTarget,
  findCandidateRevisions,
  msUntilNextRun,
  parseDemoResetConfig,
  REVISION_PAGE_SIZE,
} from './demo-reset-config';

export type DemoResetOutcome = 'restored' | 'unpinned' | 'failed';

/**
 * Restores the homepage's live demo documents to a pinned revision once a day.
 *
 * The demo panes embed editor share links, so every visitor edits the same
 * documents. The good state is kept as a revision (the history panel's "Name
 * current version") whose **id** is pinned in `WAFFLEBASE_DEMO_RESET_TARGETS`.
 * It is pinned rather than found by label because creating a revision is not
 * gated by the auth webhook: any visitor can name one anything.
 *
 * An entry without a revision id is in setup: it is never restored, and at
 * boot its newest revisions carrying `WAFFLEBASE_DEMO_RESET_LABEL` are logged
 * with their ids, for the operator to pin one.
 *
 * One in-process timer, armed at boot. Production runs a single replica; with
 * more, each restores the same revision, which leaves the same content. A
 * restart re-arms for the next run rather than resetting on boot, so a deploy
 * never wipes a demo mid-day.
 */
@Injectable()
export class DemoResetService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DemoResetService.name);
  private readonly config: DemoResetConfig;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private destroyed = false;

  constructor(
    configService: ConfigService,
    private readonly shareLinkService: ShareLinkService,
    private readonly yorkieService: YorkieService,
  ) {
    this.config = parseDemoResetConfig((key) => configService.get(key));
  }

  onApplicationBootstrap(): void {
    const { targets, hourUtc } = this.config;
    if (!targets.length) return;
    const pinned = targets.filter((t) => t.revisionId).length;
    this.logger.log(
      `demo reset: ${pinned} of ${targets.length} document(s) pinned, daily ` +
        `at ${String(hourUtc).padStart(2, '0')}:00 UTC`,
    );
    if (pinned < targets.length) {
      void this.logCandidates();
    }
    if (pinned) this.schedule();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    // A run still in flight at shutdown must not re-arm after the clear.
    if (this.destroyed) return;
    const delay = msUntilNextRun(new Date(), this.config.hourUtc);
    this.timer = setTimeout(() => {
      void this.resetAll().finally(() => this.schedule());
    }, delay);
    // The timer must not keep a shutting-down process alive.
    this.timer.unref?.();
  }

  /**
   * Reset every pinned document, one at a time. A failure is logged and does
   * not stop the others; the result is per target, in config order.
   */
  async resetAll(): Promise<DemoResetOutcome[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const outcomes: DemoResetOutcome[] = [];
      for (const target of this.config.targets) {
        outcomes.push(await this.resetOne(target));
      }
      return outcomes;
    } finally {
      this.running = false;
    }
  }

  private async resetOne({
    token,
    revisionId,
  }: DemoResetTarget): Promise<DemoResetOutcome> {
    if (!revisionId) return 'unpinned';
    try {
      const { document } = await this.shareLinkService.findByToken(token);
      await this.yorkieService.withDocument(
        document.id,
        (doc, client) => client.restoreRevision(doc, revisionId),
        // The restore happens server-side; nothing local needs pushing.
        {
          syncMode: 'readonly',
          docKeyPrefix: yorkieDocKeyPrefix(document.type),
        },
      );
      this.logger.log(
        `demo reset: restored ${document.type} ${document.id} to ${revisionId}`,
      );
      return 'restored';
    } catch (err) {
      this.logger.error(
        `demo reset: ${tokenTag(token)} failed: ${String(err)}`,
      );
      return 'failed';
    }
  }

  /** Log the labelled revisions of every unpinned target, for setup. */
  async logCandidates(): Promise<void> {
    const { label } = this.config;
    for (const { token } of this.config.targets.filter((t) => !t.revisionId)) {
      try {
        const { document } = await this.shareLinkService.findByToken(token);
        const candidates = await this.yorkieService.withDocument(
          document.id,
          (doc, client) =>
            findCandidateRevisions(
              (offset) =>
                client.listRevisions(doc, {
                  pageSize: REVISION_PAGE_SIZE,
                  offset,
                }),
              label,
            ),
          {
            syncMode: 'readonly',
            docKeyPrefix: yorkieDocKeyPrefix(document.type),
          },
        );
        const listed = candidates.length
          ? candidates
              .map((r) => `${r.id} (${r.createdAt.toISOString()})`)
              .join(', ')
          : 'none';
        this.logger.warn(
          `demo reset: ${tokenTag(token)} (${document.type} ${document.id}) ` +
            `is not pinned; revisions labelled "${label}", newest first: ` +
            `${listed}. Pin one as <token>:<revisionId>.`,
        );
      } catch (err) {
        this.logger.error(
          `demo reset: listing ${tokenTag(token)} failed: ${String(err)}`,
        );
      }
    }
  }
}

/** Only a prefix reaches the log: the token is an editor credential. */
function tokenTag(token: string): string {
  return `${token.slice(0, 8)}…`;
}
