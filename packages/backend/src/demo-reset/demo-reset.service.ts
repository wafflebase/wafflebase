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
  findNewestRevision,
  msUntilNextRun,
  parseDemoResetConfig,
  REVISION_PAGE_SIZE,
} from './demo-reset-config';

export type DemoResetOutcome = 'restored' | 'no-revision' | 'failed';

/**
 * Restores the homepage's live demo documents to a named revision once a day.
 *
 * The demo panes embed editor share links, so every visitor edits the same
 * documents. The good state is kept as a named revision (the history panel's
 * "Name current version") and this service puts it back daily; changing the
 * example is editing it and naming a new version with the same label.
 *
 * One in-process timer, armed at boot. Production runs a single replica; with
 * more, each restores the same revision, which leaves the same content. A
 * restart re-arms for the next run rather than resetting on boot, so a deploy
 * never wipes a demo mid-afternoon.
 */
@Injectable()
export class DemoResetService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DemoResetService.name);
  private readonly config: DemoResetConfig;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly shareLinkService: ShareLinkService,
    private readonly yorkieService: YorkieService,
  ) {
    this.config = parseDemoResetConfig((key) => configService.get(key));
  }

  onApplicationBootstrap(): void {
    if (!this.config.tokens.length) return;
    this.logger.log(
      `demo reset: ${this.config.tokens.length} document(s) daily at ` +
        `${String(this.config.hourUtc).padStart(2, '0')}:00 UTC to revision ` +
        `"${this.config.label}"`,
    );
    this.schedule();
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    const delay = msUntilNextRun(new Date(), this.config.hourUtc);
    this.timer = setTimeout(() => {
      void this.resetAll().finally(() => this.schedule());
    }, delay);
    // The timer must not keep a shutting-down process alive.
    this.timer.unref?.();
  }

  /**
   * Reset every configured document, one at a time. A failure is logged and
   * does not stop the others; the result is per token, in config order.
   */
  async resetAll(): Promise<DemoResetOutcome[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const outcomes: DemoResetOutcome[] = [];
      for (const token of this.config.tokens) {
        outcomes.push(await this.resetOne(token));
      }
      return outcomes;
    } finally {
      this.running = false;
    }
  }

  private async resetOne(token: string): Promise<DemoResetOutcome> {
    // Only a prefix reaches the log: the token is an editor credential.
    const tag = `${token.slice(0, 8)}…`;
    try {
      const { document } = await this.shareLinkService.findByToken(token);
      const { label } = this.config;
      const outcome = await this.yorkieService.withDocument(
        document.id,
        async (doc, client) => {
          const revision = await findNewestRevision(
            (offset) =>
              client.listRevisions(doc, {
                pageSize: REVISION_PAGE_SIZE,
                offset,
              }),
            label,
          );
          if (!revision) return 'no-revision' as const;
          await client.restoreRevision(doc, revision.id);
          return 'restored' as const;
        },
        // The restore happens server-side; nothing local needs pushing.
        {
          syncMode: 'readonly',
          docKeyPrefix: yorkieDocKeyPrefix(document.type),
        },
      );
      if (outcome === 'no-revision') {
        this.logger.warn(
          `demo reset: ${tag} (${document.type} ${document.id}) has no ` +
            `revision labelled "${label}"; left as is`,
        );
      } else {
        this.logger.log(
          `demo reset: restored ${document.type} ${document.id} to "${label}"`,
        );
      }
      return outcome;
    } catch (err) {
      this.logger.error(`demo reset: ${tag} failed: ${String(err)}`);
      return 'failed';
    }
  }
}
