import { Injectable } from '@nestjs/common';
import { NEVER, Observable } from 'rxjs';
import { ChatBusEvent } from './chat.types';

/**
 * Cross-replica fan-out of chat events over Postgres `LISTEN/NOTIFY`.
 *
 * This is a stub with the final public surface, so the channel and message
 * services can be written against it in parallel: `events$` never emits and
 * both notifiers are no-ops. Task 5 of the chat P1 plan replaces the body
 * with a dedicated `pg.Client` listening on the `chat` channel.
 */
@Injectable()
export class ChatBus {
  readonly events$: Observable<ChatBusEvent> = NEVER;

  async notifyMessage(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _e: Extract<ChatBusEvent, { t: 'msg' }>,
  ): Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async notifyMembership(_channelId: string): Promise<void> {}
}
